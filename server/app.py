"""
Sonabe — Flask + SocketIO Server
=================================
Serves the 3-D Tonal Torus visualisation and streams AI-generated Jazz
chord progressions to connected clients in real-time via WebSockets.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from flask import Flask, send_from_directory
from flask_socketio import SocketIO

from server.inference import ChordGenerator, chord_to_event
from server.midi_out import MidiOut
from server.standards import list_standards, parse_musicxml, chords_to_events

# ── Logging ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
log = logging.getLogger(__name__)

# ── Paths ────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).resolve().parent.parent
CLIENT_DIR = BASE_DIR / "client"
MODEL_DIR  = BASE_DIR / "models" / "distilgpt2_jazz_final"
DATA_DIR   = BASE_DIR / "data"

# ── Flask app ────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=None)   # disable default /static
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "sonabe-jazz-navigator")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# ── Model ────────────────────────────────────────────────────────────────
generator = ChordGenerator(MODEL_DIR)

# ── MIDI output ──────────────────────────────────────────────────────────
midi_out = MidiOut()
if midi_out.available:
    midi_out.open()

# ── Generation state ────────────────────────────────────────────────────
INTERVAL = 2.0           # seconds between chords (updated by set_tempo)
_active  = False

# ── Preview state ───────────────────────────────────────────────────────
_preview_enabled = False          # toggled by client
_preview_symbol: str | None = None  # pre-generated chord symbol

# ── Loop state ──────────────────────────────────────────────────────────
_loop_queue: list[dict] = []     # chord events to loop through
_loop_playing = False


def _generation_loop():
    global _active, _preview_symbol
    log.info("♫  Auto-play started  (%.1fs interval)", INTERVAL)
    while _active:
        # Use pre-generated chord if available, otherwise generate fresh
        if _preview_symbol:
            symbol = _preview_symbol
            _preview_symbol = None
        else:
            symbol = generator._generate_next()

        generator.history.append(symbol)
        event = chord_to_event(symbol)
        event["index"] = len(generator.history) - 1

        log.info("→  %s", event["name"])
        socketio.emit("new_chord", event)
        if midi_out.enabled and event.get("midi"):
            midi_out.send_chord(event["midi"])

        # Pre-generate and emit the ACTUAL next chord as preview
        if _preview_enabled:
            _preview_symbol = generator._generate_next()
            preview_event = chord_to_event(_preview_symbol)
            socketio.emit("next_preview", preview_event)
        else:
            socketio.emit("next_preview", None)

        socketio.sleep(INTERVAL)
    log.info("■  Auto-play stopped")


# ── Routes ───────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(str(CLIENT_DIR), "index.html")


@app.route("/<path:filename>")
def client_files(filename):
    """Serve any file from the client/ directory."""
    return send_from_directory(str(CLIENT_DIR), filename)


# ── Socket events ────────────────────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    log.info("Client connected")
    socketio.emit("midi_status", midi_out.status())
    # Full state sync so reconnecting / refreshed clients reflect server state
    socketio.emit("generation_status", {"active": _active or _std_playing})
    socketio.emit("loop_status", {
        "looping": _loop_playing,
        "count": len(_loop_queue) if _loop_playing else 0,
    })
    socketio.emit("server_state", {
        "preview_enabled": _preview_enabled,
        "temperature": generator.temperature,
    })


@socketio.on("disconnect")
def on_disconnect():
    log.info("Client disconnected")


@socketio.on("start_generation")
def on_start(_=None):
    global _active, _std_playing, _loop_playing
    if _active:
        return
    _std_playing = False     # stop standard if running
    _loop_playing = False    # stop loop if running
    _active = True
    socketio.start_background_task(_generation_loop)
    socketio.emit("generation_status", {"active": True})
    socketio.emit("loop_status", {"looping": False})


@socketio.on("stop_generation")
def on_stop(_=None):
    global _active, _std_playing, _loop_playing
    _active = False
    _std_playing = False
    _loop_playing = False
    midi_out.all_notes_off()
    socketio.emit("generation_status", {"active": False})
    socketio.emit("loop_status", {"looping": False})


# ── Loop playback ────────────────────────────────────────────────────────
def _loop_playback_loop():
    """Background task that loops through a set of chord events."""
    global _loop_playing
    log.info("🔁  Loop started  (%d chords)", len(_loop_queue))
    while _loop_playing and len(_loop_queue) > 0:
        for idx, ev in enumerate(_loop_queue):
            if not _loop_playing:
                break
            ev_copy = dict(ev, index=idx)
            socketio.emit("new_chord", ev_copy)
            if midi_out.enabled and ev_copy.get("midi"):
                midi_out.send_chord(ev_copy["midi"])
            # Preview the next chord in the loop (wraps around)
            if _preview_enabled:
                next_idx = (idx + 1) % len(_loop_queue)
                socketio.emit("next_preview", _loop_queue[next_idx])
            else:
                socketio.emit("next_preview", None)
            socketio.sleep(INTERVAL)
    _loop_playing = False
    socketio.emit("loop_status", {"looping": False})
    socketio.emit("generation_status", {"active": False})
    log.info("■  Loop stopped")


@socketio.on("start_loop")
def on_start_loop(data):
    """Client sends a list of chord names to loop."""
    global _active, _std_playing, _loop_playing, _loop_queue

    chords = data.get("chords", []) if isinstance(data, dict) else []
    if not chords:
        return

    # Stop any other playback first
    _active = False
    _std_playing = False
    _loop_playing = False
    socketio.sleep(0.1)

    # Build event queue from chord names
    _loop_queue = []
    for name in chords:
        try:
            ev = chord_to_event(name)
            _loop_queue.append(ev)
        except Exception:
            log.warning("Loop: skipping unknown chord: %s", name)

    if not _loop_queue:
        socketio.emit("loop_status", {"looping": False})
        return

    _loop_playing = True
    midi_out.all_notes_off()
    socketio.emit("generation_status", {"active": True})
    socketio.emit("loop_status", {"looping": True, "count": len(_loop_queue)})
    socketio.start_background_task(_loop_playback_loop)


@socketio.on("stop_loop")
def on_stop_loop(_=None):
    """Stop loop playback."""
    global _loop_playing
    _loop_playing = False
    midi_out.all_notes_off()
    socketio.emit("loop_status", {"looping": False})
    socketio.emit("generation_status", {"active": False})


@socketio.on("request_chord")
def on_step(_=None):
    global _preview_symbol

    # Use stashed chord if available
    if _preview_symbol:
        symbol = _preview_symbol
        _preview_symbol = None
    else:
        symbol = generator._generate_next()

    generator.history.append(symbol)
    event = chord_to_event(symbol)
    event["index"] = len(generator.history) - 1

    socketio.emit("new_chord", event)
    if midi_out.enabled and event.get("midi"):
        midi_out.send_chord(event["midi"])

    # Pre-generate the actual next chord as preview
    if _preview_enabled:
        _preview_symbol = generator._generate_next()
        preview_event = chord_to_event(_preview_symbol)
        socketio.emit("next_preview", preview_event)
    else:
        socketio.emit("next_preview", None)


@socketio.on("reset_progression")
def on_reset(_=None):
    global _preview_symbol
    _preview_symbol = None
    generator.reset()
    midi_out.all_notes_off()
    socketio.emit("progression_reset")
    log.info("Progression reset")


@socketio.on("set_tempo")
def on_set_tempo(data):
    """Client sends BPM → server computes interval (one bar = 4 beats)."""
    global INTERVAL
    bpm = data.get("bpm") if isinstance(data, dict) else data
    try:
        bpm = float(bpm)
        if bpm < 20:
            bpm = 20
        elif bpm > 400:
            bpm = 400
        INTERVAL = (60.0 / bpm) * 4   # one bar of 4/4
        log.info("♩  Tempo set to %d BPM  → interval %.2fs", int(bpm), INTERVAL)
    except (TypeError, ValueError):
        log.warning("set_tempo: invalid bpm value: %s", data)


@socketio.on("set_temperature")
def on_set_temperature(data):
    """Client adjusts the generation temperature."""
    temp = data.get("temperature") if isinstance(data, dict) else data
    try:
        temp = float(temp)
        temp = max(0.1, min(2.5, temp))
        generator.temperature = temp
        log.info("🌡  Temperature set to %.2f", temp)
    except (TypeError, ValueError):
        log.warning("set_temperature: invalid value: %s", data)


@socketio.on("toggle_preview")
def on_toggle_preview(data):
    """Client toggles next-chord preview on/off."""
    global _preview_enabled, _preview_symbol
    enabled = data.get("enabled", False) if isinstance(data, dict) else bool(data)
    _preview_enabled = enabled
    if not enabled:
        # Don't discard _preview_symbol — if one was pre-generated it will
        # still be used as the next chord (already in the pipeline).
        # Just tell the client to hide the preview UI.
        socketio.emit("next_preview", None)
    log.info("🔮  Preview %s", "enabled" if enabled else "disabled")


# ── Discover mode ────────────────────────────────────────────────────────
@socketio.on("discover_chord")
def on_discover_chord(data):
    """
    User clicked a chord in Discover mode.
    Add it to generator history, play it, and return next-chord probabilities.
    """
    chord = data.get("chord") if isinstance(data, dict) else data
    if not chord:
        return

    generator.history.append(chord)
    event = chord_to_event(chord)
    event["index"] = len(generator.history) - 1
    socketio.emit("new_chord", event)
    if midi_out.enabled and event.get("midi"):
        midi_out.send_chord(event["midi"])

    # Predict next-chord probabilities
    probs = generator.predict_next_probs()
    socketio.emit("discover_probabilities", probs)


# ── Standards playback state ─────────────────────────────────────────────
_std_queue: list[dict] = []      # events waiting to be played
_std_playing = False
_std_meta: dict = {}              # title / composer / style / key


def _standard_playback_loop():
    """Background task that steps through a loaded standard."""
    global _std_playing
    log.info("♫  Standard playback started: %s", _std_meta.get("title", "?"))
    idx = 0
    while _std_playing and idx < len(_std_queue):
        ev = _std_queue[idx]
        socketio.emit("new_chord", ev)
        if midi_out.enabled and ev.get("midi"):
            midi_out.send_chord(ev["midi"])
        # Preview the next chord in the standard queue
        if _preview_enabled and idx + 1 < len(_std_queue):
            socketio.emit("next_preview", _std_queue[idx + 1])
        else:
            socketio.emit("next_preview", None)
        socketio.sleep(INTERVAL)
        idx += 1
    _std_playing = False
    socketio.emit("standard_finished")
    socketio.emit("generation_status", {"active": False})
    log.info("■  Standard playback finished")


@socketio.on("list_standards")
def on_list_standards(_=None):
    """Return the list of available jazz standards."""
    standards = list_standards(DATA_DIR)
    socketio.emit("standards_list", standards)


@socketio.on("load_standard")
def on_load_standard(data):
    """Parse and load a jazz standard for playback."""
    global _active, _std_playing, _std_queue, _std_meta

    # Stop any active generation/playback first
    _active = False
    _std_playing = False
    socketio.sleep(0.1)

    filename = data.get("filename") if isinstance(data, dict) else data
    xml_path = DATA_DIR / filename

    if not xml_path.is_file():
        socketio.emit("standard_error", {"message": f"File not found: {filename}"})
        return

    try:
        parsed = parse_musicxml(xml_path)
        _std_meta = {
            "title": parsed["title"],
            "composer": parsed["composer"],
            "style": parsed["style"],
            "key": parsed["key"],
            "chord_count": len(parsed["chords"]),
        }
        _std_queue = chords_to_events(parsed)
        generator.reset()
        midi_out.all_notes_off()
        socketio.emit("progression_reset")
        socketio.emit("standard_loaded", _std_meta)
        log.info("Loaded standard: %s (%d chords)", parsed["title"], len(_std_queue))
    except Exception as e:
        log.error("Failed to parse %s: %s", filename, e)
        socketio.emit("standard_error", {"message": str(e)})


@socketio.on("play_standard")
def on_play_standard(_=None):
    """Start playing the loaded standard."""
    global _active, _std_playing
    if not _std_queue:
        socketio.emit("standard_error", {"message": "No standard loaded"})
        return
    if _std_playing:
        return
    _active = False          # stop AI generation if running
    _std_playing = True
    socketio.emit("generation_status", {"active": True})
    socketio.start_background_task(_standard_playback_loop)


@socketio.on("stop_standard")
def on_stop_standard(_=None):
    """Stop standard playback."""
    global _std_playing
    _std_playing = False
    midi_out.all_notes_off()
    socketio.emit("generation_status", {"active": False})


@socketio.on("clear_standard")
def on_clear_standard(_=None):
    """Unload the current standard."""
    global _std_playing, _std_queue, _std_meta
    _std_playing = False
    _std_queue = []
    _std_meta = {}
    midi_out.all_notes_off()
    socketio.emit("standard_cleared")
    log.info("Standard cleared")


# ── MIDI control events ─────────────────────────────────────────────────
@socketio.on("midi_enable")
def on_midi_enable(_=None):
    """Toggle MIDI output on."""
    if not midi_out.available:
        socketio.emit("midi_status", midi_out.status())
        return
    if not midi_out.enabled:
        midi_out.open()
    socketio.emit("midi_status", midi_out.status())
    log.info("MIDI enabled")


@socketio.on("midi_disable")
def on_midi_disable(_=None):
    """Toggle MIDI output off."""
    midi_out.close()
    socketio.emit("midi_status", midi_out.status())
    log.info("MIDI disabled")


@socketio.on("midi_set_channel")
def on_midi_channel(data):
    """Set the MIDI channel (0-15)."""
    ch = int(data.get("channel", 0)) if isinstance(data, dict) else int(data)
    midi_out.channel = ch
    socketio.emit("midi_status", midi_out.status())


@socketio.on("midi_set_velocity")
def on_midi_velocity(data):
    """Set the default MIDI velocity (1-127)."""
    vel = int(data.get("velocity", 100)) if isinstance(data, dict) else int(data)
    midi_out.velocity = vel
    socketio.emit("midi_status", midi_out.status())
