// =============================================================================
// Sonabe — Tonal Torus Chord Map (Client-Side)
// =============================================================================
// Mirrors the Python server/inference.py torus mapping so the client can build
// the wireframe scaffold and label geometry without server round-trips.
//
// Torus parametric surface:
//   x = (R + r·cos φ) · cos θ       θ = Circle of Fifths (ring)
//   y = (R + r·cos φ) · sin θ       φ = Quality / tension (tube)
//   z = r · sin φ
// =============================================================================

const ChordMap = (() => {

    // ── Torus geometry (must match Python) ──────────────────────────────────
    const R = 3.0;   // major radius
    const r = 1.2;   // minor radius

    // ── Circle of Fifths ────────────────────────────────────────────────────
    const FIFTHS = ["C","G","D","A","E","B","F#","Db","Ab","Eb","Bb","F"];

    const ENHARMONIC = {
        "C#":"Db","D#":"Eb","E#":"F","Fb":"E",
        "G#":"Ab","A#":"Bb","B#":"C","Gb":"F#",
    };

    // ── Quality → (phi, tension) ────────────────────────────────────────────
    // Arranged in monotonically increasing φ within each family:
    //   Major(0) → Suspended(π/4) → Dominant(π/2) → Minor(π)
    //   → Augmented(~1.35π) → Diminished(~1.75π)
    const QUALITY_MAP = {
        // ── Major family ────────────────────────────────────────────────
        "maj7":    [0.0,             0.10],
        "6":       [0.15,            0.12],
        "add9":    [0.25,            0.14],
        "maj9":    [0.30,            0.16],
        "maj7#11": [0.50,            0.28],
        // ── Suspended family ────────────────────────────────────────────
        "sus4":    [Math.PI * 0.25,  0.22],
        "7sus4":   [Math.PI * 0.30,  0.30],
        // ── Dominant family ─────────────────────────────────────────────
        "7":       [Math.PI * 0.50,  0.40],
        "9":       [Math.PI * 0.52,  0.42],
        "13":      [Math.PI * 0.55,  0.48],
        "7b9":     [Math.PI * 0.62,  0.70],
        "7#9":     [Math.PI * 0.65,  0.72],
        "7alt":    [Math.PI * 0.75,  0.85],
        // ── Minor family ────────────────────────────────────────────────
        "m6":      [Math.PI * 0.88,  0.25],
        "m7":      [Math.PI,         0.30],
        "m9":      [Math.PI * 1.05,  0.35],
        "mMaj7":   [Math.PI * 1.12,  0.45],
        // ── Augmented family ────────────────────────────────────────────
        "aug7":    [Math.PI * 1.35,  0.60],
        // ── Diminished family ───────────────────────────────────────────
        "m7b5":    [Math.PI * 1.55,  0.65],
        "dim7":    [Math.PI * 1.75,  0.80],
    };

    const QUALITY_LABELS = {
        "maj7":"Major 7th",     "7":"Dominant 7th",    "m7":"Minor 7th",
        "m7b5":"Half-Dim",      "dim7":"Diminished",   "aug7":"Augmented",
        "6":"Major 6th",        "m6":"Minor 6th",      "9":"Dominant 9th",
        "m9":"Minor 9th",       "13":"Dominant 13th",  "7#9":"Hendrix",
        "7b9":"Dom ♭9",         "7alt":"Altered",      "sus4":"Sus 4",
        "7sus4":"Dom sus4",     "maj9":"Major 9th",    "add9":"Add 9",
        "mMaj7":"Min-Maj 7",    "maj7#11":"Lydian",
    };

    // ── Quality family classification (for colouring nodes) ─────────────────
    // Returns a category string so nodes can be coloured by family rather than
    // just root hue. This makes the quality axis visible.
    const QUALITY_FAMILY = {
        "maj7":"major", "6":"major", "add9":"major", "maj9":"major", "maj7#11":"major",
        "sus4":"suspended", "7sus4":"suspended",
        "7":"dominant", "9":"dominant", "13":"dominant",
        "7b9":"dominant", "7#9":"dominant", "7alt":"dominant",
        "m6":"minor", "m7":"minor", "m9":"minor", "mMaj7":"minor",
        "aug7":"augmented",
        "m7b5":"diminished", "dim7":"diminished",
    };

    const FAMILY_COLOR = {
        "major":      { h: 215, s: 0.65, l: 0.60 },   // #5ea8ff  blue
        "suspended":  { h: 198, s: 0.60, l: 0.72 },   // #8bd4ff  light blue
        "dominant":   { h:  42, s: 1.00, l: 0.65 },   // #ffc44d  gold
        "minor":      { h:  18, s: 1.00, l: 0.63 },   // #ff7849  orange
        "augmented":  { h: 268, s: 0.80, l: 0.68 },   // #c97dff  purple
        "diminished": { h: 348, s: 1.00, l: 0.63 },   // #ff4466  red
    };

    // ── Voicing intervals (must match server VOICING_MAP) ───────────────────
    const VOICING_MAP = {
        "maj7":     [0, 4, 7, 11],
        "6":        [0, 4, 7, 9],
        "add9":     [0, 4, 7, 14],
        "maj9":     [0, 4, 7, 11, 14],
        "maj7#11":  [0, 4, 7, 11, 18],
        "sus4":     [0, 5, 7, 12],
        "7sus4":    [0, 5, 7, 10],
        "7":        [0, 4, 7, 10],
        "9":        [0, 4, 7, 10, 14],
        "13":       [0, 4, 7, 10, 14, 21],
        "7b9":      [0, 4, 7, 10, 13],
        "7#9":      [0, 4, 7, 10, 15],
        "7alt":     [0, 4, 6, 10, 13],
        "m6":       [0, 3, 7, 9],
        "m7":       [0, 3, 7, 10],
        "m9":       [0, 3, 7, 10, 14],
        "mMaj7":    [0, 3, 7, 11],
        "aug7":     [0, 4, 8, 10],
        "m7b5":     [0, 3, 6, 10],
        "dim7":     [0, 3, 6, 9],
    };

    // ── Root MIDI notes (octave 3) ──────────────────────────────────────────
    const ROOT_MIDI = {
        "C":48,"G":43,"D":50,"A":45,"E":52,"B":47,
        "F#":54,"Db":49,"Ab":44,"Eb":51,"Bb":46,"F":53,
    };

    // ── Colour helpers ──────────────────────────────────────────────────────
    const ROOT_HUES = {};
    FIFTHS.forEach((root, i) => { ROOT_HUES[root] = (i * 30) % 360; });

    function rootHue(root) {
        const r2 = ENHARMONIC[root] || root;
        return ROOT_HUES[r2] ?? 0;
    }

    function qualityFamily(quality) {
        return QUALITY_FAMILY[quality] || "dominant";
    }

    function familyColor(quality) {
        const fam = qualityFamily(quality);
        return FAMILY_COLOR[fam] || FAMILY_COLOR["dominant"];
    }

    // ── Core math ───────────────────────────────────────────────────────────
    function rootIndex(root) {
        const r2 = ENHARMONIC[root] || root;
        const idx = FIFTHS.indexOf(r2);
        return idx >= 0 ? idx : 0;
    }

    function rootToTheta(root) {
        return (2 * Math.PI * rootIndex(root)) / 12;
    }

    function qualityToPhiTension(quality) {
        const entry = QUALITY_MAP[quality];
        return entry ? { phi: entry[0], tension: entry[1] }
                     : { phi: Math.PI * 0.5, tension: 0.5 };
    }

    /** Convert torus (θ, φ) → Cartesian (x, y, z). */
    function torusToXYZ(theta, phi) {
        return {
            x: (R + r * Math.cos(phi)) * Math.cos(theta),
            y: (R + r * Math.cos(phi)) * Math.sin(theta),
            z: r * Math.sin(phi),
        };
    }

    /** Full chord-name → 3D coordinate lookup. */
    function chordToPosition(name) {
        const root = (name.length >= 2 && (name[1] === 'b' || name[1] === '#'))
                     ? name.slice(0, 2) : name.slice(0, 1);
        const quality = name.slice(root.length) || "maj7";
        const theta = rootToTheta(root);
        const { phi, tension } = qualityToPhiTension(quality);
        const pos = torusToXYZ(theta, phi);
        return { ...pos, theta, phi, tension, root, quality };
    }

    /** Get MIDI notes for a chord. */
    function chordToMidi(root, quality) {
        const r2 = ENHARMONIC[root] || root;
        const baseMidi = ROOT_MIDI[r2] ?? 48;
        const intervals = VOICING_MAP[quality] || [0, 4, 7, 11];
        return intervals.map(iv => baseMidi + iv);
    }

    // ── Scaffold builders ───────────────────────────────────────────────────

    function buildRootRing(quality = "maj7") {
        const { phi } = qualityToPhiTension(quality);
        return FIFTHS.map(root => {
            const theta = rootToTheta(root);
            const pos = torusToXYZ(theta, phi);
            return { root, theta, ...pos };
        });
    }

    function buildScaffold() {
        const points = [];
        for (const root of FIFTHS) {
            const theta = rootToTheta(root);
            for (const [quality, [phi, tension]] of Object.entries(QUALITY_MAP)) {
                const pos = torusToXYZ(theta, phi);
                const fam = qualityFamily(quality);
                const fc = FAMILY_COLOR[fam];
                points.push({
                    name: `${root}${quality}`,
                    root, quality,
                    ...pos, tension,
                    hue: ROOT_HUES[root],
                    family: fam,
                    familyHue: fc.h,
                    familySat: fc.s,
                    familyLit: fc.l,
                });
            }
        }
        return points;
    }

    return {
        R, r,
        FIFTHS, QUALITY_MAP, QUALITY_LABELS, QUALITY_FAMILY,
        FAMILY_COLOR, VOICING_MAP, ROOT_MIDI, ROOT_HUES,
        rootIndex, rootToTheta, rootHue,
        qualityFamily, familyColor,
        qualityToPhiTension, torusToXYZ,
        chordToPosition, chordToMidi,
        buildRootRing, buildScaffold,
    };
})();
