"""
Sonabe — MIDI Output Engine
=============================
Opens a virtual MIDI port named **"Sonabe"** so that any DAW (Ableton,
Reaper, Logic, Bitwig …) can receive the generated chord voicings as
standard MIDI note-on / note-off messages in real time.

Dependencies
------------
- ``mido``         — high-level MIDI message API
- ``python-rtmidi`` — cross-platform MIDI I/O back-end  (ALSA on Linux,
  CoreMIDI on macOS, WinMM on Windows)

The module is designed to be safely importable even when *python-rtmidi*
is not installed — it degrades gracefully and logs a warning.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

log = logging.getLogger(__name__)

# ── Attempt to import mido ──────────────────────────────────────────────
try:
    import mido                          # type: ignore[import-untyped]
    _MIDO_AVAILABLE = True
except ImportError:
    _MIDO_AVAILABLE = False
    log.warning(
        "mido / python-rtmidi not installed — MIDI output disabled.  "
        "Install with:  pip install mido python-rtmidi"
    )


# ═════════════════════════════════════════════════════════════════════════
# Public MIDI Output Controller
# ═════════════════════════════════════════════════════════════════════════

class MidiOut:
    """Manages a virtual MIDI output port and sends chord voicings.

    Parameters
    ----------
    port_name : str
        Name of the virtual MIDI port (visible in the DAW).
    channel : int
        MIDI channel 0-15 (default 0).
    velocity : int
        Default note-on velocity 1-127 (default 100).
    """

    PORT_NAME = "Sonabe"

    def __init__(
        self,
        port_name: str = PORT_NAME,
        channel: int = 0,
        velocity: int = 100,
    ):
        self._port_name = port_name
        self._channel: int = max(0, min(15, channel))
        self._velocity: int = max(1, min(127, velocity))
        self._enabled: bool = False
        self._port: Optional[mido.ports.BaseOutput] = None  # type: ignore[name-defined]
        self._held_notes: list[int] = []     # Currently sounding MIDI notes
        self._lock = threading.Lock()

    # ── Port management ──────────────────────────────────────────────

    @property
    def available(self) -> bool:
        """True when the mido library is installed."""
        return _MIDO_AVAILABLE

    @property
    def enabled(self) -> bool:
        return self._enabled

    def open(self) -> bool:
        """Open (or re-open) the virtual MIDI port.  Returns success."""
        if not _MIDO_AVAILABLE:
            return False
        with self._lock:
            self._close_port()
            try:
                self._port = mido.open_output(     # type: ignore[attr-defined]
                    self._port_name, virtual=True
                )
                self._enabled = True
                log.info("🎹  MIDI port opened: '%s'", self._port_name)
                return True
            except Exception as exc:
                log.error("Failed to open MIDI port: %s", exc)
                self._enabled = False
                return False

    def close(self):
        """Close the port and release held notes."""
        with self._lock:
            self._all_notes_off()
            self._close_port()
            self._enabled = False
            log.info("MIDI port closed")

    def _close_port(self):
        if self._port and not self._port.closed:
            try:
                self._port.close()
            except Exception:
                pass
        self._port = None

    # ── Configuration ────────────────────────────────────────────────

    @property
    def channel(self) -> int:
        return self._channel

    @channel.setter
    def channel(self, value: int):
        with self._lock:
            self._all_notes_off()
            self._channel = max(0, min(15, value))
            log.info("MIDI channel → %d", self._channel + 1)

    @property
    def velocity(self) -> int:
        return self._velocity

    @velocity.setter
    def velocity(self, value: int):
        self._velocity = max(1, min(127, value))

    # ── Note sending ─────────────────────────────────────────────────

    def send_chord(self, midi_notes: list[int], velocity: int | None = None):
        """Send note-on messages for *midi_notes* after releasing any
        previously held notes.

        The caller is responsible for timing — this method returns
        immediately.  Notes will be released on the *next* call to
        ``send_chord`` or when ``all_notes_off`` is called.
        """
        if not self._enabled or not self._port or self._port.closed:
            return
        vel = velocity if velocity is not None else self._velocity
        vel = max(1, min(127, vel))

        with self._lock:
            # Release previous chord
            self._all_notes_off()

            # Send new chord
            for note in midi_notes:
                note = max(0, min(127, note))
                msg = mido.Message(          # type: ignore[attr-defined]
                    "note_on",
                    channel=self._channel,
                    note=note,
                    velocity=vel,
                )
                self._port.send(msg)
                self._held_notes.append(note)

    def all_notes_off(self):
        """Public wrapper — release all sounding notes."""
        with self._lock:
            self._all_notes_off()

    def _all_notes_off(self):
        """Release every note currently held (must hold _lock)."""
        if not self._port or self._port.closed:
            self._held_notes.clear()
            return
        for note in self._held_notes:
            try:
                msg = mido.Message(          # type: ignore[attr-defined]
                    "note_off",
                    channel=self._channel,
                    note=note,
                    velocity=0,
                )
                self._port.send(msg)
            except Exception:
                pass
        self._held_notes.clear()

    def send_cc(self, control: int, value: int):
        """Send a MIDI Control Change message (e.g. sustain pedal)."""
        if not self._enabled or not self._port or self._port.closed:
            return
        with self._lock:
            msg = mido.Message(              # type: ignore[attr-defined]
                "control_change",
                channel=self._channel,
                control=max(0, min(127, control)),
                value=max(0, min(127, value)),
            )
            self._port.send(msg)

    # ── Status dict (for the frontend) ───────────────────────────────

    def status(self) -> dict:
        """Return a JSON-serialisable status dict."""
        return {
            "available": self.available,
            "enabled": self._enabled,
            "port_name": self._port_name,
            "channel": self._channel,
            "velocity": self._velocity,
        }

    def __repr__(self) -> str:
        state = "open" if self._enabled else "closed"
        return (
            f"MidiOut('{self._port_name}', ch={self._channel + 1}, "
            f"vel={self._velocity}, {state})"
        )
