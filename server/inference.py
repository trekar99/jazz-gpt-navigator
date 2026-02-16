"""
Sonabe — Chord Inference Engine
================================
Loads a fine-tuned DistilGPT-2 checkpoint trained on a custom ~198-token
Jazz vocabulary and auto-regressively generates chord symbols, mapping
each to 3-D coordinates on a Tonal Torus (Krumhansl–Kessler space).

Coordinate system
-----------------
θ (theta)  — Circle of Fifths position   (ring angle, 0 → 2π)
φ (phi)    — Chord quality / tension      (tube angle)

  x = (R + r·cos φ) · cos θ
  y = (R + r·cos φ) · sin θ
  z =      r·sin φ

  R = 3.0  (major radius)   r = 1.2  (tube radius)
"""

from __future__ import annotations

import logging
import math
import os
from pathlib import Path

import numpy as np
import torch
from transformers import GPT2LMHeadModel

log = logging.getLogger(__name__)

# ── Torus geometry ───────────────────────────────────────────────────────
TORUS_R = 3.0
TORUS_r = 1.2

# ── Circle of Fifths ────────────────────────────────────────────────────
FIFTHS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"]

ENHARMONIC = {
    "C#": "Db", "D#": "Eb", "E#": "F", "Fb": "E",
    "G#": "Ab", "A#": "Bb", "B#": "C", "Gb": "F#",
}

# ── Quality → (φ, tension) ──────────────────────────────────────────────
# Arranged in monotonically increasing φ within each quality family:
#   Major    (φ ≈ 0)          — consonant, stable
#   Suspended(φ ≈ π/4)        — ambiguous, open
#   Dominant (φ ≈ π/2)        — driving, needs resolution
#   Minor    (φ ≈ π)          — dark, warm
#   Diminished/Augmented (φ ≈ 3π/2) — tense, unstable
QUALITY_MAP: dict[str, tuple[float, float]] = {
    # ── Major family ─────────────────────────────────────────────────
    "maj7":     (0.0,             0.10),
    "6":        (0.15,            0.12),
    "add9":     (0.25,            0.14),
    "maj9":     (0.30,            0.16),
    "maj7#11":  (0.50,            0.28),
    # ── Suspended family ─────────────────────────────────────────────
    "sus4":     (math.pi * 0.25,  0.22),
    "7sus4":    (math.pi * 0.30,  0.30),
    # ── Dominant family ──────────────────────────────────────────────
    "7":        (math.pi * 0.50,  0.40),
    "9":        (math.pi * 0.52,  0.42),
    "13":       (math.pi * 0.55,  0.48),
    "7b9":      (math.pi * 0.62,  0.70),
    "7#9":      (math.pi * 0.65,  0.72),
    "7alt":     (math.pi * 0.75,  0.85),
    # ── Minor family ─────────────────────────────────────────────────
    "m6":       (math.pi * 0.88,  0.25),
    "m7":       (math.pi,         0.30),
    "m9":       (math.pi * 1.05,  0.35),
    "mMaj7":    (math.pi * 1.12,  0.45),
    # ── Augmented family ─────────────────────────────────────────────
    "aug7":     (math.pi * 1.35,  0.60),
    # ── Diminished family ────────────────────────────────────────────
    "m7b5":     (math.pi * 1.55,  0.65),
    "dim7":     (math.pi * 1.75,  0.80),
}

_DEFAULT_PHI     = math.pi * 0.5
_DEFAULT_TENSION = 0.50

# ── Voicing intervals (semitones from root) ─────────────────────────────
# Used by the client synth engine — sent along with each chord event so
# the browser can voice the chord with Web Audio.
VOICING_MAP: dict[str, list[int]] = {
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
}


# ═════════════════════════════════════════════════════════════════════════
# Torus helpers
# ═════════════════════════════════════════════════════════════════════════
def _root_to_theta(root: str) -> float:
    r = ENHARMONIC.get(root, root)
    idx = FIFTHS.index(r) if r in FIFTHS else 0
    return 2 * math.pi * idx / 12


def _quality_to_phi_tension(quality: str) -> tuple[float, float]:
    return QUALITY_MAP.get(quality, (_DEFAULT_PHI, _DEFAULT_TENSION))


def _torus_xyz(theta: float, phi: float) -> tuple[float, float, float]:
    x = (TORUS_R + TORUS_r * math.cos(phi)) * math.cos(theta)
    y = (TORUS_R + TORUS_r * math.cos(phi)) * math.sin(theta)
    z = TORUS_r * math.sin(phi)
    return round(x, 4), round(y, 4), round(z, 4)


# ── MIDI note numbers for root notes (octave 3 = middle register) ───────
_ROOT_MIDI: dict[str, int] = {
    "C": 48, "G": 43, "D": 50, "A": 45, "E": 52, "B": 47,
    "F#": 54, "Db": 49, "Ab": 44, "Eb": 51, "Bb": 46, "F": 53,
}


def _root_to_midi(root: str) -> int:
    """Return the MIDI note number for a root in octave 3."""
    r = ENHARMONIC.get(root, root)
    return _ROOT_MIDI.get(r, 48)


def chord_to_event(name: str) -> dict:
    """Parse a chord symbol and return a full event dict with 3-D coords + voicing."""
    name = name.strip()
    if len(name) >= 2 and name[1] in "b#":
        root, quality = name[:2], name[2:] or "maj7"
    else:
        root, quality = name[0], name[1:] or "maj7"

    theta = _root_to_theta(root)
    phi, tension = _quality_to_phi_tension(quality)
    x, y, z = _torus_xyz(theta, phi)

    # Build MIDI voicing: root MIDI + intervals
    root_midi = _root_to_midi(root)
    intervals = VOICING_MAP.get(quality, [0, 4, 7, 11])
    midi_notes = [root_midi + iv for iv in intervals]

    return {
        "name": name, "root": root, "quality": quality,
        "tension": round(tension, 4),
        "theta": round(theta, 4), "phi": round(phi, 4),
        "coordinates": [x, y, z],
        "midi": midi_notes,
    }


# ═════════════════════════════════════════════════════════════════════════
# Token cleaning — reassemble decomposed vocab into chord symbols
# ═════════════════════════════════════════════════════════════════════════
_SKIP = frozenset({
    "<start>", "<end>", "<pad>", "<unk>", "<style>",
    "|", ":|", "|:", ".", "b||", "e||", "N.C.", "Tonality",
})

_ROOTS = frozenset({
    "C", "D", "E", "F", "G", "A", "B",
    "C#", "D#", "E#", "F#", "G#", "A#", "B#",
    "Cb", "Db", "Eb", "Fb", "Gb", "Ab", "Bb",
    "C##", "D##", "E##", "F##", "G##", "A##", "B##",
    "Cbb", "Dbb", "Ebb", "Fbb", "Gbb", "Abb", "Bbb",
})

_QUALITY_SUFFIX = {
    "maj7": "maj7", "m7": "m7", "dom7": "7", "m": "m7",
    "maj": "maj7", "maj6": "6", "m6": "m6", "aug": "aug7",
    "o": "dim7", "o7": "dim7", "o_maj7": "dim7",
    "sus4": "sus4", "sus7": "7sus4", "power": "maj7",
    "major-13th": "13",
}

_ALTER_SUFFIX = {
    "add 7": "7", "add 9": "9", "add 13": "13",
    "add b9": "7b9", "add #9": "7#9", "add #11": "maj7#11",
    "add #5": "aug7", "add #7": "maj7", "add b13": "7alt",
    "add b6": "m6", "add 2": "add9", "add 11": "9",
    "alter b9": "7b9", "alter #9": "7#9", "alter #11": "maj7#11",
    "alter b5": "m7b5", "alter #5": "aug7",
}

_STYLES = frozenset({
    "Jazz", "Latin", "Bossa", "Ballad", "Blues", "Funk", "Rock",
    "Pop", "Soul", "Folk", "Disco", "Reggae", "Shuffle", "Waltz",
    "Tango", "Samba", "Mambo", "Bolero", "March", "Hymn", "Gospel",
    "Calypso", "Musical", "Slowly", "Salsa", "Son", "Montuno",
    "Merengue", "Choro", "Frevo", "Foxtrot", "RnB", "Afro",
    "Dreamlike",
})


def _is_meta(tok: str) -> bool:
    if tok in _SKIP or tok in _STYLES:
        return True
    try:
        float(tok)
        return True
    except ValueError:
        pass
    if tok.endswith((" major", " minor")):
        return True
    if tok.startswith(("Form_", "Repeat_")):
        return True
    if " " in tok and not tok.startswith(("add ", "alter ")):
        return True
    return False


def _reassemble_chords(tokens: list[str]) -> list[str]:
    """Walk token list and return clean chord symbols."""
    chords: list[str] = []
    root = None
    suffix = ""

    def flush():
        nonlocal root, suffix
        if root:
            chords.append(root + (suffix or "maj7"))
        root = None
        suffix = ""

    for tok in tokens:
        if _is_meta(tok):
            continue
        if tok in _ROOTS:
            flush()
            root = tok
            suffix = ""
        elif tok in _QUALITY_SUFFIX and root:
            suffix = _QUALITY_SUFFIX[tok]
        elif tok in _ALTER_SUFFIX and root:
            suffix = _ALTER_SUFFIX[tok]

    flush()
    return chords


# ═════════════════════════════════════════════════════════════════════════
# ChordGenerator
# ═════════════════════════════════════════════════════════════════════════
_SUFFIX_TO_VOCAB = {
    "maj7": "maj7", "m7": "m7", "7": "dom7", "6": "maj6",
    "m6": "m6", "aug7": "aug", "dim7": "o7", "sus4": "sus4",
    "7sus4": "sus7", "9": "dom7", "13": "dom7",
    "7b9": "dom7", "7#9": "dom7", "7alt": "dom7",
    "maj7#11": "maj7", "add9": "maj7", "maj9": "maj7",
    "m9": "m7", "m7b5": "m7", "mMaj7": "m7",
}


class ChordGenerator:
    """Auto-regressive Jazz chord generator backed by a fine-tuned DistilGPT-2."""

    def __init__(self, model_path: str | os.PathLike):
        self.history: list[str] = []
        self._queue: list[str] = []
        self.temperature: float = 0.9
        self._load(Path(model_path))

    # ── loading ──────────────────────────────────────────────────────
    def _load(self, model_dir: Path):
        model_dir = model_dir.resolve()
        if not model_dir.is_dir():
            raise FileNotFoundError(f"Model directory not found: {model_dir}")

        # Vocabulary
        tokens_path = model_dir / "tokens.npy"
        if not tokens_path.is_file():
            alt = model_dir.parent / "tokens.npy"
            if alt.is_file():
                tokens_path = alt
            else:
                raise FileNotFoundError(f"tokens.npy not found in {model_dir}")

        tokens = np.load(tokens_path, allow_pickle=True)
        self.token_to_id = {str(t): i for i, t in enumerate(tokens)}
        self.id_to_token = {i: str(t) for i, t in enumerate(tokens)}
        self.vocab_size = len(tokens)
        self.pad_id = self.token_to_id.get("<pad>", 0)
        self.bos_id = self.token_to_id.get("<start>", 0)
        self.eos_id = self.token_to_id.get("<end>", 0)

        # Model
        self.model = GPT2LMHeadModel.from_pretrained(str(model_dir))
        self.model.eval()

        if self.model.config.vocab_size != self.vocab_size:
            log.warning("Vocab mismatch (model=%d, tokens=%d) — resizing",
                        self.model.config.vocab_size, self.vocab_size)
            self.model.resize_token_embeddings(self.vocab_size)

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)
        log.info("Model loaded on %s  (vocab=%d)", self.device, self.vocab_size)

    # ── encode / decode ──────────────────────────────────────────────
    def _encode(self, symbols: list[str]) -> list[int]:
        ids = [self.bos_id]
        bar_id = self.token_to_id.get("|")
        for sym in symbols:
            if len(sym) >= 2 and sym[1] in "b#":
                root, quality = sym[:2], sym[2:] or "maj7"
            else:
                root, quality = sym[0], sym[1:] or "maj7"
            if bar_id is not None:
                ids.append(bar_id)
            rid = self.token_to_id.get(root)
            if rid is not None:
                ids.append(rid)
            qid = self.token_to_id.get(_SUFFIX_TO_VOCAB.get(quality, "maj7"))
            if qid is not None:
                ids.append(qid)
        return ids

    def _decode(self, ids: torch.Tensor) -> list[str]:
        return [self.id_to_token.get(i, "<unk>") for i in ids.tolist()]

    # ── public API ───────────────────────────────────────────────────
    def next_chord(self) -> dict:
        symbol = self._generate_next()
        self.history.append(symbol)
        event = chord_to_event(symbol)
        event["index"] = len(self.history) - 1
        return event

    def predict_next_probs(self, history: list[str] | None = None) -> dict[str, float]:
        """
        Given a history of chord symbols, return a probability distribution
        over the *scaffold* chord vocabulary (root × quality combos) for
        the most likely next chord.

        Returns { "Cmaj7": 0.12, "Dm7": 0.08, … } — only scaffold chords
        with non-negligible probability (> 0.5 %).
        """
        ctx = (history if history is not None else self.history)[-8:]
        ids = torch.tensor([self._encode(ctx)], dtype=torch.long, device=self.device)
        mask = torch.ones_like(ids)

        with torch.no_grad():
            outputs = self.model(input_ids=ids, attention_mask=mask)
            logits = outputs.logits[0, -1, :]           # (vocab_size,)

        # Softmax over full vocabulary
        probs = torch.softmax(logits, dim=0).cpu().numpy()

        # Build root-token → root-name mapping
        root_probs: dict[str, np.ndarray] = {}
        for root in FIFTHS:
            r = ENHARMONIC.get(root, root)
            rid = self.token_to_id.get(r)
            if rid is not None:
                root_probs[r] = probs[rid]

        # For each root, compute P(root) × P(quality | root)
        # Approximate: P(chord) ≈ P(root_token) × P(quality_token)
        # since in the decomposed vocab they are sequential tokens
        quality_tokens = set(_SUFFIX_TO_VOCAB.values())
        quality_sum = sum(
            probs[self.token_to_id[qt]]
            for qt in quality_tokens
            if qt in self.token_to_id
        )

        result: dict[str, float] = {}
        for root in FIFTHS:
            r = ENHARMONIC.get(root, root)
            rid = self.token_to_id.get(r)
            if rid is None:
                continue
            p_root = float(probs[rid])

            for suffix, vocab_tok in _SUFFIX_TO_VOCAB.items():
                qid = self.token_to_id.get(vocab_tok)
                if qid is None:
                    continue
                p_qual = float(probs[qid])
                # Joint probability estimate (normalised later)
                p_joint = p_root * p_qual
                chord_name = f"{r}{suffix}"
                # Accumulate (multiple suffixes may map to same vocab token)
                if chord_name in result:
                    result[chord_name] = max(result[chord_name], p_joint)
                else:
                    result[chord_name] = p_joint

        # Normalise to sum=1
        total = sum(result.values())
        if total > 0:
            result = {k: v / total for k, v in result.items()}

        # Filter to only scaffold chords (root × QUALITY_MAP keys)
        scaffold_chords: dict[str, float] = {}
        for root in FIFTHS:
            r = ENHARMONIC.get(root, root)
            for quality in QUALITY_MAP:
                chord_name = f"{r}{quality}"
                if chord_name in result:
                    scaffold_chords[chord_name] = round(result[chord_name], 6)

        return scaffold_chords

    def reset(self):
        self.history.clear()
        self._queue.clear()
        log.info("Generator reset")

    # ── generation ───────────────────────────────────────────────────
    def _generate_next(self) -> str:
        if self._queue:
            return self._queue.pop(0)

        ctx = self.history[-8:] if self.history else []
        ids = torch.tensor([self._encode(ctx)], dtype=torch.long, device=self.device)
        mask = torch.ones_like(ids)

        with torch.no_grad():
            out = self.model.generate(
                input_ids=ids,
                attention_mask=mask,
                max_new_tokens=32,
                temperature=self.temperature,
                top_k=40,
                top_p=0.92,
                do_sample=True,
                pad_token_id=self.pad_id,
                eos_token_id=self.eos_id,
            )

        tokens = self._decode(out[0])
        chords = _reassemble_chords(tokens)

        # Strip context echo
        start = 0
        for i, c in enumerate(chords):
            if i < len(ctx) and c == ctx[i]:
                start = i + 1
            else:
                break
        chords = chords[start:]

        if not chords:
            log.warning("No valid chords generated — defaulting to Cmaj7")
            return "Cmaj7"

        self._queue.extend(chords[1:])
        return chords[0]
