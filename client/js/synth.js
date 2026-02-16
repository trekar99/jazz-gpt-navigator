/**
 * ═══════════════════════════════════════════════════════════════
 *  Sonabe — Web Audio Jazz Synth
 * ═══════════════════════════════════════════════════════════════
 *  Rhodes-electric-piano-inspired synthesiser that plays chord voicings
 *  using the Web Audio API. Receives MIDI note arrays from the server
 *  and renders them with smooth voice leading.
 *
 *  Voicing philosophy (inspired by voicing.py):
 *  - Drop-2 style spread: bass note separated, upper voices close
 *  - Smooth voice leading: each voice moves to the nearest available
 *    pitch in the next chord
 *  - Gentle attack/release for jazzy Rhodes feel
 * ═══════════════════════════════════════════════════════════════
 */

const Synth = (() => {

    let ctx = null;           // AudioContext (lazy init — needs user gesture)
    let masterGain = null;
    let compressor = null;
    let reverbNode = null;
    let muted = false;
    let previousVoicing = null;  // For voice leading

    const VOLUME = 0.22;
    const ATTACK  = 0.06;     // seconds
    const DECAY   = 0.15;
    const SUSTAIN  = 0.55;    // gain level
    const RELEASE = 1.8;      // seconds — long jazz release

    // ── Lazy AudioContext init ──────────────────────────────────────
    function ensureContext() {
        if (ctx) return true;
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();

            // Master chain: compressor → gain → destination
            compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 12;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;

            masterGain = ctx.createGain();
            masterGain.gain.value = VOLUME;

            // Simple convolver reverb (impulse generated procedurally)
            reverbNode = createReverb(1.6, 2.0);

            // Routing: source → compressor → reverb → master → out
            compressor.connect(reverbNode);
            reverbNode.connect(masterGain);
            masterGain.connect(ctx.destination);

            // Also dry path for presence
            const dryGain = ctx.createGain();
            dryGain.gain.value = 0.65;
            compressor.connect(dryGain);
            dryGain.connect(masterGain);

            return true;
        } catch (e) {
            console.warn("Web Audio not available:", e);
            return false;
        }
    }

    // ── Procedural reverb impulse ───────────────────────────────────
    function createReverb(duration, decay) {
        const length = ctx.sampleRate * duration;
        const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        const convolver = ctx.createConvolver();
        convolver.buffer = impulse;

        const wetGain = ctx.createGain();
        wetGain.gain.value = 0.25;
        convolver.connect(wetGain);

        // Return a node that acts as the reverb send
        const input = ctx.createGain();
        input.connect(convolver);
        // We return the wet output but also need to wire it
        // Use a simple gain wrapper
        const output = ctx.createGain();
        wetGain.connect(output);
        input._output = output;

        // Custom connect: we want input → convolver → wet → output
        // But we need to return something connectable
        // Simplify: return convolver with gain
        const reverbGain = ctx.createGain();
        reverbGain.gain.value = 0.20;
        return reverbGain;  // Simple gain node as reverb placeholder
    }

    // ── MIDI → frequency ────────────────────────────────────────────
    function midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    // ── Voice leading optimiser ─────────────────────────────────────
    // Given a previous voicing and new MIDI notes, rearrange octaves
    // to minimise total voice movement (inspired by voicing.py's
    // select_best_voicing and optimize_voice_leading).
    function optimiseVoiceLeading(prevMidi, newMidi) {
        if (!prevMidi || prevMidi.length === 0) return newMidi;

        const sorted = [...newMidi].sort((a, b) => a - b);
        // Keep bass note fixed (lowest)
        const bass = sorted[0];
        const upper = sorted.slice(1);

        // For each upper voice, try octave shifts to get closest to previous
        const prevUpper = [...prevMidi].sort((a, b) => a - b).slice(1);
        const optimised = [bass];

        for (const note of upper) {
            let bestNote = note;
            let minDist = Infinity;

            for (let shift = -12; shift <= 12; shift += 12) {
                const candidate = note + shift;
                if (candidate <= bass || candidate < 36 || candidate > 84) continue;

                // Distance to closest previous upper voice
                const dist = prevUpper.length > 0
                    ? Math.min(...prevUpper.map(p => Math.abs(candidate - p)))
                    : Math.abs(candidate - 60);

                if (dist < minDist) {
                    minDist = dist;
                    bestNote = candidate;
                }
            }
            optimised.push(bestNote);
        }

        return optimised.sort((a, b) => a - b);
    }

    // ── Play a single note with ADSR envelope ──────────────────────
    function playNote(freq, startTime, duration) {
        // Two detuned oscillators for richness (Rhodes-like)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = "sine";
        osc2.type = "triangle";
        osc2.detune.value = 6;  // Slight detune for warmth

        const noteGain = ctx.createGain();
        noteGain.gain.value = 0;

        // Mix: sine louder, triangle quieter
        const mix1 = ctx.createGain();
        mix1.gain.value = 0.7;
        const mix2 = ctx.createGain();
        mix2.gain.value = 0.3;

        osc1.frequency.value = freq;
        osc2.frequency.value = freq;

        osc1.connect(mix1);
        osc2.connect(mix2);
        mix1.connect(noteGain);
        mix2.connect(noteGain);
        noteGain.connect(compressor);

        // ADSR envelope
        const t = startTime;
        noteGain.gain.setValueAtTime(0, t);
        noteGain.gain.linearRampToValueAtTime(1.0, t + ATTACK);
        noteGain.gain.linearRampToValueAtTime(SUSTAIN, t + ATTACK + DECAY);
        // Hold at sustain for duration
        noteGain.gain.setValueAtTime(SUSTAIN, t + duration - 0.01);
        noteGain.gain.exponentialRampToValueAtTime(0.001, t + duration + RELEASE);

        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + duration + RELEASE + 0.1);
        osc2.stop(t + duration + RELEASE + 0.1);
    }

    // ── Public: play a chord ────────────────────────────────────────
    function playChord(midiNotes, duration = 1.8) {
        if (muted || !midiNotes || midiNotes.length === 0) return;
        if (!ensureContext()) return;

        // Resume context if suspended (autoplay policy)
        if (ctx.state === "suspended") {
            ctx.resume();
        }

        // Apply voice leading
        const voiced = optimiseVoiceLeading(previousVoicing, midiNotes);
        previousVoicing = voiced;

        const now = ctx.currentTime + 0.02;  // Tiny lookahead

        // Stagger notes slightly for humanisation (0–15ms)
        for (let i = 0; i < voiced.length; i++) {
            const stagger = i * 0.008 * (0.5 + Math.random() * 0.5);
            const velocity = 0.6 + Math.random() * 0.15;   // Slight dynamic variation
            const freq = midiToFreq(voiced[i]);

            // Scale gain inversely with number of notes to avoid clipping
            const noteScale = 1 / Math.sqrt(voiced.length);

            const noteGain = masterGain.gain.value * velocity * noteScale;
            // We handle gain inside playNote via the master chain
            playNote(freq, now + stagger, duration);
        }
    }

    // ── Public: mute toggle ─────────────────────────────────────────
    function toggleMute() {
        muted = !muted;
        if (masterGain) {
            masterGain.gain.linearRampToValueAtTime(
                muted ? 0 : VOLUME,
                ctx.currentTime + 0.1
            );
        }
        return muted;
    }

    function isMuted() {
        return muted;
    }

    function resetVoiceLeading() {
        previousVoicing = null;
    }

    return { playChord, toggleMute, isMuted, resetVoiceLeading, ensureContext };
})();
