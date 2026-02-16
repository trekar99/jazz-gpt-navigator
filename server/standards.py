"""
Sonabe — Jazz Standards Loader
================================
Parses iReal Pro MusicXML files from the data/ folder, extracting harmony
(chord progressions) with their durations.  Converts MusicXML chord
representations into the same event format used by the AI generator so
the torus navigator can play real standards side-by-side with generated
sequences.

MusicXML harmony format (iReal Pro export):
  <harmony>
    <root>
      <root-step>C</root-step>
      <root-alter>0</root-alter>   ← 0=natural, 1=sharp, -1=flat
    </root>
    <kind text="maj7">major-seventh</kind>
    <bass>                          ← optional slash chord
      <bass-step>E</bass-step>
      <bass-alter>0</bass-alter>
    </bass>
  </harmony>
"""

from __future__ import annotations

import logging
import os
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

from server.inference import chord_to_event

log = logging.getLogger(__name__)

# ── MusicXML kind text → our quality suffix ──────────────────────────────
_KIND_TEXT_MAP: dict[str, str] = {
    # Major
    "maj7":       "maj7",
    "Maj7":       "maj7",
    "6":          "6",
    "add9":       "add9",
    "maj9":       "maj9",
    "Maj9":       "maj9",
    "maj7#11":    "maj7#11",
    "Maj7#11":    "maj7#11",
    # Suspended
    "sus4":       "sus4",
    "sus":        "sus4",
    "7sus4":      "7sus4",
    "sus2":       "sus4",
    # Dominant
    "7":          "7",
    "9":          "9",
    "13":         "13",
    "7b9":        "7b9",
    "7#9":        "7#9",
    "7alt":       "7alt",
    "7b5":        "7alt",
    "7#11":       "13",
    "7b13":       "7alt",
    "7#5":        "aug7",
    # Minor
    "m":          "m7",
    "m6":         "m6",
    "m7":         "m7",
    "min7":       "m7",
    "-7":         "m7",
    "m9":         "m9",
    "min9":       "m9",
    "m(maj7)":    "mMaj7",
    "m(Maj7)":    "mMaj7",
    "mMaj7":      "mMaj7",
    "m11":        "m9",
    "m13":        "m9",
    # Augmented
    "aug":        "aug7",
    "+":          "aug7",
    "+7":         "aug7",
    "aug7":       "aug7",
    # Diminished
    "dim":        "dim7",
    "o":          "dim7",
    "dim7":       "dim7",
    "o7":         "dim7",
    "m7b5":       "m7b5",
    "ø":          "m7b5",
    "ø7":         "m7b5",
    # Edge cases
    "":           "maj7",
    "maj":        "maj7",
    "major":      "maj7",
    "5":          "maj7",   # power chord → treat as major
}

# ── MusicXML kind element text → our quality suffix  (fallback) ──────────
_KIND_NAME_MAP: dict[str, str] = {
    "major":              "maj7",
    "minor":              "m7",
    "dominant":           "7",
    "major-seventh":      "maj7",
    "minor-seventh":      "m7",
    "dominant-ninth":     "9",
    "major-sixth":        "6",
    "minor-sixth":        "m6",
    "diminished":         "dim7",
    "diminished-seventh": "dim7",
    "half-diminished":    "m7b5",
    "augmented":          "aug7",
    "augmented-seventh":  "aug7",
    "suspended-fourth":   "sus4",
    "suspended-second":   "sus4",
    "dominant-13th":      "13",
    "major-ninth":        "maj9",
    "minor-ninth":        "m9",
    "major-minor":        "mMaj7",
    "power":              "maj7",
    "none":               "maj7",
    "other":              "7",
}

# ── Accidental helpers ───────────────────────────────────────────────────
_ALTER_MAP = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}


def _parse_alter(alter_el: Optional[ET.Element]) -> str:
    """Convert <root-alter> or <bass-alter> element to accidental string."""
    if alter_el is None or alter_el.text is None:
        return ""
    try:
        val = int(float(alter_el.text))
    except ValueError:
        return ""
    return _ALTER_MAP.get(val, "")


# ═════════════════════════════════════════════════════════════════════════
# Public API
# ═════════════════════════════════════════════════════════════════════════

def parse_musicxml(xml_path: str | Path) -> dict:
    """
    Parse a single MusicXML file and return a structured dict.

    Returns
    -------
    {
        "title":     str,
        "composer":  str,
        "style":     str,
        "key":       str,
        "chords":    [ { "symbol": "Cmaj7", "beats": 4, "measure": 1 }, ... ]
    }
    """
    tree = ET.parse(str(xml_path))
    root = tree.getroot()

    # ── Metadata ─────────────────────────────────────────────────────
    title_el = root.find(".//{*}movement-title")
    title = title_el.text.strip() if title_el is not None and title_el.text else Path(xml_path).stem

    composer = ""
    style = ""
    for creator in root.findall(".//{*}creator"):
        ctype = creator.get("type", "")
        if ctype == "composer" and creator.text:
            composer = creator.text.strip()
        elif ctype == "lyricist" and creator.text:
            style = creator.text.strip()      # iReal stores style in "lyricist"

    # ── Key signature ────────────────────────────────────────────────
    key_el = root.find(".//{*}key")
    key_str = ""
    if key_el is not None:
        fifths_el = key_el.find("{*}fifths")
        mode_el = key_el.find("{*}mode")
        if fifths_el is not None and fifths_el.text is not None:
            _KEY_SIG = ["Cb","Gb","Db","Ab","Eb","Bb","F",
                        "C","G","D","A","E","B","F#","C#"]
            idx = int(fifths_el.text) + 7
            idx = max(0, min(idx, len(_KEY_SIG) - 1))
            key_note = _KEY_SIG[idx]
            mode = mode_el.text if (mode_el is not None and mode_el.text) else "major"
            key_str = f"{key_note} {mode}"

    # ── Divisions (ticks per quarter note) ───────────────────────────
    divisions = 768   # default for iReal Pro MusicXML
    div_el = root.find(".//{*}divisions")
    if div_el is not None and div_el.text:
        divisions = int(div_el.text)

    whole_note_ticks = divisions * 4   # ticks in a whole note

    # ── Walk measures, extract harmonies ─────────────────────────────
    chords: list[dict] = []

    for measure in root.findall(".//{*}measure"):
        mnum = int(measure.get("number", 0))

        # Collect harmonies with their offsets
        measure_harmonies = []
        for harmony in measure.findall("{*}harmony"):
            root_step_el = harmony.find("{*}root/{*}root-step")
            root_alter_el = harmony.find("{*}root/{*}root-alter")

            if root_step_el is None or root_step_el.text is None:
                continue

            note = root_step_el.text + _parse_alter(root_alter_el)

            # Determine quality from kind element
            kind_el = harmony.find("{*}kind")
            quality = "maj7"  # default
            if kind_el is not None:
                # Prefer the 'text' attribute (e.g. "m7", "7", "maj7")
                kind_text = kind_el.get("text", "")
                kind_name = kind_el.text or ""

                if kind_text in _KIND_TEXT_MAP:
                    quality = _KIND_TEXT_MAP[kind_text]
                elif kind_name.lower() in _KIND_NAME_MAP:
                    quality = _KIND_NAME_MAP[kind_name.lower()]
                else:
                    quality = "maj7"

            symbol = f"{note}{quality}"
            measure_harmonies.append(symbol)

        if not measure_harmonies:
            continue

        # Determine beats per chord in this measure
        # Count total duration in the measure from notes
        total_dur = 0
        for note_el in measure.findall("{*}note"):
            dur_el = note_el.find("{*}duration")
            if dur_el is not None and dur_el.text:
                # Only count non-chord notes (avoid double counting)
                chord_el = note_el.find("{*}chord")
                if chord_el is None:
                    total_dur += int(dur_el.text)

        # Calculate beats for the measure
        measure_beats = max(1, round(total_dur / divisions)) if total_dur > 0 else 4

        # Split beats evenly among chords in the measure
        beats_per_chord = max(1, measure_beats // len(measure_harmonies))

        for symbol in measure_harmonies:
            chords.append({
                "symbol": symbol,
                "beats": beats_per_chord,
                "measure": mnum,
            })

    return {
        "title": title,
        "composer": composer,
        "style": style,
        "key": key_str,
        "chords": chords,
    }


def chords_to_events(parsed: dict) -> list[dict]:
    """
    Convert the parsed standard into a list of torus events
    (same format as ChordGenerator.next_chord()).
    """
    events = []
    for i, ch in enumerate(parsed["chords"]):
        ev = chord_to_event(ch["symbol"])
        ev["index"] = i
        ev["beats"] = ch["beats"]
        ev["measure"] = ch["measure"]
        events.append(ev)
    return events


def list_standards(data_dir: str | Path) -> list[dict]:
    """
    Return a sorted list of available standards with metadata.

    Each entry:  { "filename": "All Of Me.xml", "title": "All Of Me" }
    Reads only filenames — does NOT parse XMLs for speed.
    """
    data_dir = Path(data_dir)
    if not data_dir.is_dir():
        log.warning("Data directory not found: %s", data_dir)
        return []

    standards = []
    for f in sorted(data_dir.iterdir()):
        if f.suffix.lower() == ".xml":
            title = f.stem
            standards.append({
                "filename": f.name,
                "title": title,
            })

    log.info("Found %d jazz standards in %s", len(standards), data_dir)
    return standards
