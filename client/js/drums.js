/**
 * ═══════════════════════════════════════════════════════════════
 *  Sonabe — Jazz Drum Kit  (WAV Sample-Based)
 * ═══════════════════════════════════════════════════════════════
 *  Loads pre-rendered drum WAV samples from /audio/*.wav via
 *  fetch + decodeAudioData, then plays them back with per-hit
 *  pitch/gain humanisation for a natural, kit-like feel.
 *
 *  Styles:  Swing · Bebop · Ballad · Bossa Nova · Cool
 *  Each carries its own BPM — the server adjusts its chord
 *  emission interval accordingly.
 *
 *  API
 *  ───
 *    Drums.enable(style)      arm (playBar produces sound)
 *    Drums.disable()          disarm
 *    Drums.playBar(dur)       schedule one bar of dur seconds
 *    Drums.setStyle(name)     change style
 *    Drums.getStyles()        [{key, label, bpm}, …]
 *    Drums.isActive()         armed?
 *    Drums.setVolume(v)       0-1
 *    Drums.getBPM()           current style BPM
 *    Drums.getBarDuration()   seconds per bar for current style
 *    Drums.startFree(style)   free-running (Discover / idle)
 *    Drums.stopFree()
 *    Drums.ensureContext()    init audio (returns Promise)
 *
 *    Legacy: start→enable, stop→disable, isPlaying→isActive
 * ═══════════════════════════════════════════════════════════════
 */

/* global Synth */
const Drums = (() => {

/* ─── State ───────────────────────────────────────────────────── */
let ctx        = null;
let masterGain = null;
let convolver  = null;
let reverbSend = null;
let enabled    = false;
let curStyle   = "swing";
let barCount   = 0;

// Free-running
let freeRunning = false;
let freeTimer   = null;
let freeNext    = 0;

const VOLUME     = 0.32;
const REVERB_MIX = 0.18;

/* ═════════════════════════════════════════════════════════════════
   Sample bank — loaded from WAV files
   ═════════════════════════════════════════════════════════════════ */
const bank = {};       // { ride: AudioBuffer, kick: AudioBuffer, … }
let bankReady = false;

const SAMPLE_LIST = [
    "ride", "ride_bell", "hh_closed", "hh_open", "hh_foot",
    "kick", "snare", "brush", "cross_stick", "shaker", "tom", "crash",
];

async function loadSamples() {
    const promises = SAMPLE_LIST.map(async name => {
        const url = `audio/${name}.wav`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
            const arrayBuf = await resp.arrayBuffer();
            bank[name] = await ctx.decodeAudioData(arrayBuf);
        } catch (e) {
            console.warn(`Drums: failed to load ${url}`, e);
        }
    });
    await Promise.all(promises);
}


/* ═════════════════════════════════════════════════════════════════
   Audio context & reverb
   ═════════════════════════════════════════════════════════════════ */

async function ensureContext() {
    if (ctx && bankReady) return true;
    try {
        if (typeof Synth !== "undefined") Synth.ensureContext();
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();

        if (!masterGain) {
            masterGain = ctx.createGain();
            masterGain.gain.value = VOLUME;

            // Convolution reverb (procedural impulse response)
            convolver = ctx.createConvolver();
            convolver.buffer = buildImpulse(1.4, 2.6);
            reverbSend = ctx.createGain();
            reverbSend.gain.value = REVERB_MIX;
            reverbSend.connect(convolver).connect(masterGain);

            masterGain.connect(ctx.destination);
        }

        if (!bankReady) {
            await loadSamples();
            bankReady = true;
            const loaded = Object.keys(bank).length;
            console.log(`🥁 Drum sample bank ready (${loaded}/${SAMPLE_LIST.length} samples)`);
        }
        return true;
    } catch (e) {
        console.warn("Drums: init failed", e);
        return false;
    }
}

function buildImpulse(dur, decay) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++)
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
}


/* ═════════════════════════════════════════════════════════════════
   Sample playback
   ═════════════════════════════════════════════════════════════════ */

/**
 * Play a named sample at scheduled time t with given volume.
 * rateShift adds a deterministic offset on top of random ±1.5%.
 */
function hit(name, t, vol, rateShift = 0) {
    const buf = bank[name];
    if (!buf || !ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Slight random pitch variation for realism
    src.playbackRate.value = 1.0 + rateShift + (Math.random() - 0.5) * 0.03;
    const g = ctx.createGain();
    g.gain.value = Math.max(0.001, vol);
    src.connect(g).connect(masterGain);
    // Reverb send
    const rg = ctx.createGain();
    rg.gain.value = Math.max(0.001, vol * 0.28);
    src.connect(rg).connect(reverbSend);
    src.start(t);
}

/* ── Named shortcuts (for pattern readability) ─────────────────── */
const ride       = (t, v) => hit("ride",        t, v);
const rideBell   = (t, v) => hit("ride_bell",   t, v, 0.02);
const hhClosed   = (t, v) => hit("hh_closed",   t, v);
const hhFoot     = (t, v) => hit("hh_foot",     t, v);
const hhOpen     = (t, v) => hit("hh_open",     t, v);
const kick       = (t, v) => hit("kick",        t, v);
const snare      = (t, v) => hit("snare",       t, v);
const brush      = (t, v) => hit("brush",       t, v);
const crossStick = (t, v) => hit("cross_stick", t, v);
const shaker     = (t, v) => hit("shaker",      t, v);
const tom        = (t, v) => hit("tom",         t, v);
const crash      = (t, v) => hit("crash",       t, v);

/* ── Humanisation ──────────────────────────────────────────────── */
const h   = (r) => (Math.random() * 2 - 1) * r;      // velocity jitter
const jit = (m) => (Math.random() * 2 - 1) * m;      // micro-timing


/* ═════════════════════════════════════════════════════════════════
   Style definitions
   ═════════════════════════════════════════════════════════════════
   Each style has a BPM and a schedule(t0, D, bar) function that
   fills one bar of length D seconds starting at time t0.
   ═════════════════════════════════════════════════════════════════ */

const STYLES = {

    /* ──────────── SWING ──────────── */
    swing: {
        label: "Swing", bpm: 140,
        schedule(t0, D, bar) {
            const q  = D / 4;
            const sw = 0.67;                      // swing ratio
            const e8 = q / 2;

            for (let b = 0; b < 4; b++) {
                const bt  = t0 + b * q;
                const off = bt + e8 * (1 + sw);   // swung up-beat

                // Ride — down + swung up
                ride(bt  + jit(0.004), 0.48 + h(0.06));
                ride(off + jit(0.006), 0.22 + h(0.04));

                // Hi-hat foot on 2 & 4
                if (b === 1 || b === 3) hhFoot(bt + jit(0.005), 0.28 + h(0.04));

                // Cross-stick on 2 & 4
                if (b === 1 || b === 3) crossStick(bt + jit(0.004), 0.22 + h(0.04));

                // Kick: beat 1 strong, beat 3 lighter, occasional push on 4-and
                if (b === 0) kick(bt + jit(0.003), 0.30 + h(0.04));
                if (b === 2) kick(bt + jit(0.005), 0.15 + h(0.03));
                if (b === 3 && Math.random() > 0.78)
                    kick(off + jit(0.006), 0.11 + h(0.03));

                // Ghost brush anticipation before beat 4
                if (b === 2) brush(off + jit(0.008), 0.08 + h(0.02));
            }
            // Ride bell every 4th bar (phrase marker)
            if (bar % 4 === 0) rideBell(t0 + jit(0.003), 0.18 + h(0.04));
        },
    },

    /* ──────────── BEBOP ──────────── */
    bebop: {
        label: "Bebop", bpm: 220,
        schedule(t0, D, bar) {
            const q  = D / 4;
            const sw = 0.60;
            const e8 = q / 2;

            for (let b = 0; b < 4; b++) {
                const bt  = t0 + b * q;
                const off = bt + e8 * (1 + sw);

                // Aggressive ride
                ride(bt  + jit(0.003), 0.52 + h(0.06));
                ride(off + jit(0.004), 0.28 + h(0.05));

                // Hi-hat foot on 2 & 4
                if (b === 1 || b === 3) hhFoot(bt + jit(0.003), 0.34 + h(0.04));

                // Cross-stick 2 & 4 (lighter)
                if (b === 1 || b === 3) crossStick(bt + jit(0.003), 0.18 + h(0.03));

                // Kick on 1 only
                if (b === 0) kick(bt + jit(0.002), 0.22 + h(0.04));

                // Kick bombs on random up-beats
                if (b === 1 && Math.random() > 0.60)
                    kick(off + jit(0.005), 0.28 + h(0.05));
                if (b === 3 && Math.random() > 0.72)
                    snare(bt + jit(0.004), 0.14 + h(0.03));
            }
            // Ride bell phrase marker
            if (bar % 3 === 0) rideBell(t0 + jit(0.002), 0.15 + h(0.04));
        },
    },

    /* ──────────── BALLAD ─────────── */
    ballad: {
        label: "Ballad", bpm: 60,
        schedule(t0, D, bar) {
            const q = D / 4;

            for (let b = 0; b < 4; b++) {
                const bt = t0 + b * q;

                // Soft ride on 1 & 3
                if (b === 0 || b === 2)
                    ride(bt + jit(0.010), 0.18 + h(0.04));

                // Brushes on 2 & 4
                if (b === 1 || b === 3)
                    brush(bt + jit(0.012), 0.22 + h(0.04));

                // Hi-hat foot 2 & 4
                if (b === 1 || b === 3)
                    hhFoot(bt + jit(0.008), 0.14 + h(0.03));

                // Gentle kick on 1
                if (b === 0) kick(bt + jit(0.008), 0.14 + h(0.03));
            }
            // Ride bell every 8 bars
            if (bar % 8 === 0) rideBell(t0, 0.11 + h(0.03));
        },
    },

    /* ──────────── BOSSA NOVA ─────── */
    bossa: {
        label: "Bossa Nova", bpm: 140,
        schedule(t0, D, bar) {
            const s16 = D / 16;

            // Bossa clave (cross-stick)
            [0, 3, 6, 8, 11, 14].forEach(i =>
                crossStick(t0 + i * s16 + jit(0.003), 0.26 + h(0.04)));

            // Surdo kick pattern
            kick(t0 + 0  * s16 + jit(0.003), 0.28 + h(0.04));
            kick(t0 + 8  * s16 + jit(0.003), 0.24 + h(0.03));
            kick(t0 + 6  * s16 + jit(0.004), 0.13 + h(0.03));
            kick(t0 + 14 * s16 + jit(0.004), 0.11 + h(0.02));

            // Hi-hat on 8ths
            for (let i = 0; i < 16; i += 2)
                hhClosed(t0 + i * s16 + jit(0.002), 0.16 + h(0.03));

            // Shaker on 16ths
            for (let i = 0; i < 16; i++)
                shaker(t0 + i * s16 + jit(0.002), 0.06 + h(0.02));
        },
    },

    /* ──────────── COOL ──────────── */
    cool: {
        label: "Cool", bpm: 108,
        schedule(t0, D, bar) {
            const q  = D / 4;
            const sw = 0.55;
            const e8 = q / 2;

            for (let b = 0; b < 4; b++) {
                const bt  = t0 + b * q;
                const off = bt + e8 * (1 + sw);

                // Spacious ride — fewer hits
                if (b === 0 || b === 2)
                    ride(bt + jit(0.008), 0.34 + h(0.04));
                if ((b === 1 || b === 3) && Math.random() > 0.45)
                    ride(off + jit(0.010), 0.13 + h(0.03));

                // Brush 2 & 4
                if (b === 1 || b === 3)
                    brush(bt + jit(0.008), 0.18 + h(0.03));

                // Hi-hat foot
                if (b === 1 || b === 3)
                    hhFoot(bt + jit(0.006), 0.18 + h(0.03));

                // Gentle kick on 1
                if (b === 0) kick(bt + jit(0.005), 0.14 + h(0.03));
            }
        },
    },
};


/* ═════════════════════════════════════════════════════════════════
   Synced mode — playBar(barDuration) from new_chord handler
   ═════════════════════════════════════════════════════════════════ */

function playBar(barDuration) {
    if (!enabled || !ctx || !bankReady) return;
    if (ctx.state === "suspended") ctx.resume();
    const style = STYLES[curStyle];
    if (!style) return;
    const t0 = ctx.currentTime + 0.005;
    style.schedule(t0, barDuration, barCount);
    barCount++;
}


/* ═════════════════════════════════════════════════════════════════
   Free-running mode (Discover / idle)
   ═════════════════════════════════════════════════════════════════ */

function startFree(styleName) {
    ensureContext().then(ok => {
        if (!ok) return;
        if (ctx.state === "suspended") ctx.resume();
        if (styleName) curStyle = styleName;
        freeRunning = true;
        freeNext    = ctx.currentTime + 0.05;
        barCount    = 0;
        if (freeTimer) clearInterval(freeTimer);
        freeTimer = setInterval(freeScheduler, 25);
    });
}

function stopFree() {
    freeRunning = false;
    if (freeTimer) { clearInterval(freeTimer); freeTimer = null; }
}

function freeScheduler() {
    const style = STYLES[curStyle];
    if (!style || !freeRunning || !bankReady) return;
    if (freeNext < ctx.currentTime + 0.10) {
        const barDur = (60 / style.bpm) * 4;
        style.schedule(freeNext, barDur, barCount);
        barCount++;
        freeNext += barDur;
    }
}


/* ═════════════════════════════════════════════════════════════════
   Public API
   ═════════════════════════════════════════════════════════════════ */

function enable(styleName = "swing") {
    curStyle = styleName;
    barCount = 0;
    enabled  = true;
    ensureContext();
}

function disable() {
    enabled = false;
    stopFree();
    barCount = 0;
}

function setStyle(name) {
    if (!STYLES[name]) return;
    curStyle = name;
    barCount = 0;
}

function isActive()  { return enabled; }

function getBPM() {
    const s = STYLES[curStyle];
    return s ? s.bpm : 120;
}

function getBarDuration() {
    return (60 / getBPM()) * 4;      // 4 beats per bar
}

function getStyles() {
    return Object.entries(STYLES).map(([key, s]) => ({
        key, label: s.label, bpm: s.bpm,
    }));
}

function setVolume(v) {
    if (masterGain)
        masterGain.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.05);
}

return {
    enable, disable, playBar, isActive,
    startFree, stopFree,
    setStyle, getStyles, setVolume,
    getBPM, getBarDuration, ensureContext,
    // Legacy
    start: enable, stop: disable, isPlaying: isActive,
};

})();
