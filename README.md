---
title: Jazz GPT Navigator
emoji: 🎷
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
app_port: 7860
short_description: Transformer jazz harmony navigator on a 3D Tonal Torus. 
---

# Sonabe | Jazz GPT Navigator

**Real-time AI Jazz harmony exploration on a 3-D Tonal Torus.**

Sonabe is an interactive web application that visualises AI-generated jazz chord progressions on a **Tonal Torus** — a topological surface where the Circle of Fifths wraps around the ring axis and chord quality/tension maps along the tube axis. A fine-tuned **DistilGPT-2** model generates harmonically coherent progressions that are streamed in real-time to a Three.js 3-D scene via WebSockets. Each chord is sounded through a built-in Rhodes-style Web Audio synthesiser with intelligent voice leading, and can optionally be sent as MIDI messages to any DAW.

> This project was developed as part of the *Generative Algorithms for Sound and Music* course (SMC Master's programme, Universitat Pompeu Fabra).

---

## Literature Review

Sonabe builds upon and is informed by the following prior works in the field of music visualisation and generative harmony:

- **ChromaFlow** — An interactive system that maps harmonic content to visual flow representations, exploring the relationship between musical structure and visual perception of tonal movement.
- **ANIMA Harmonic Space** (David Dalmazzo) — A framework for spatial representation and navigation of harmonic relationships, providing foundational concepts for mapping tonal relationships onto geometric surfaces.

These works informed key design decisions in Sonabe, particularly the use of toroidal topology for harmonic space, the mapping of tonal distance to visual proximity, and the interactive exploration paradigm where users navigate through harmony both aurally and visually.

---

## Features

| Feature | Description |
|---|---|
| **Tonal Torus** | Wireframe torus with 240 scaffold chord nodes positioned via Krumhansl–Kessler tonal space coordinates |
| **AI Chord Generation** | DistilGPT-2 fine-tuned on a custom ~198-token decomposed Jazz vocabulary generates chord progressions auto-regressively |
| **Real-time Streaming** | Flask-SocketIO pushes each chord to the browser via WebSocket; a glowing navigator orb animates to the new position |
| **Chord Audio Playback** | Web Audio Rhodes-style synth with dual detuned oscillators, ADSR envelopes, and procedural reverb |
| **Voice Leading** | Automatic octave optimisation minimises pitch distance between successive voicings for smooth transitions |
| **Chord Labels** | CSS2DRenderer labels on every scaffold node show chord names directly on the torus |
| **Navigator & Ghost Orbs** | Colour-coded orbs that match the chord's root hue — navigator (current chord) and ghost (next chord preview) |
| **Coloured Trail** | Per-segment vertex-coloured trail line behind the navigator, tinted by each chord's root |
| **Raycasting Tooltips** | Hover over any scaffold node to see chord name and quality label |
| **Bloom Post-processing** | Unreal Bloom pass for cinematic glow |
| **Progression Timeline** | Live chip-bar tracking the full chord history |
| **Auto-play & Step** | Continuous generation or single-chord stepping |
| **Loop Mode** | Loop the current chord progression with preview of upcoming chords |
| **Next Chord Preview** | Pre-generated preview with ghost orb on the torus and HUD label |
| **Temperature Control** | Colour-coded slider (blue→green→red) controlling generation creativity (0.1–2.5) |
| **Mute Toggle** | Silence audio without stopping generation |
| **Jazz Drum Machine** | Five jazz rhythm styles (Swing, Bossa Nova, Bebop, Ballad, Latin) with WAV samples synced to chord tempo |
| **Discover Mode** | Interactive probability heatmap — click nodes to explore the model's harmonic predictions |
| **Jazz Standards Browser** | Load and play through 4,000+ jazz standards parsed from MusicXML |
| **MIDI → DAW** | Virtual MIDI port sends note-on/note-off messages so any DAW can receive the chords |
| **Keyboard Shortcuts** | Full keyboard control for all features |
| **Docker / HF Spaces** | Dockerfile included for deployment on Hugging Face Spaces |

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Start / Stop generation |
| `A` | Step — generate a single chord |
| `R` | Reset progression |
| `M` | Mute / unmute sound |
| `← →` | Decrease / increase temperature |
| `T` | Reset temperature to default (0.9) |
| `L` | Toggle loop mode |
| `P` | Toggle next-chord preview |
| `I` | Toggle MIDI output |
| `D` | Toggle Discover mode |
| `S` | Open Standards browser |
| `Enter` | Play loaded standard |
| `1`–`5` | Select rhythm style (1=Swing, 2=Bebop, 3=Ballad, 4=Bossa, 5=Cool) |
| `0` | Stop rhythm |
| `H` | Toggle info panel |
| `Esc` | Close Standards modal |
| Mouse drag | Orbit camera |
| Scroll | Zoom in/out |
| Hover | Inspect scaffold node |

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Browser (client/)                                            │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Three.js  │  │ Socket.IO │  │chord-map │  │ synth.js   │  │
│  │  main.js  │◄─┤  client   │  │(torus    │  │(Web Audio) │  │
│  │ +CSS2D    │  └─────┬─────┘  │ math)    │  └────────────┘  │
│  └───────────┘        │        └──────────┘  ┌────────────┐  │
│                       │                      │ drums.js   │  │
│                       │                      │(WAV drums) │  │
│                       │                      └────────────┘  │
└───────────────────────┼──────────────────────────────────────┘
                        │ WebSocket
┌───────────────────────┼──────────────────────────────────────┐
│  Server (server/)     │                                      │
│  ┌─────────────┐  ┌───┴───────┐  ┌────────────────────────┐  │
│  │   app.py    │──┤ SocketIO  │  │   inference.py         │  │
│  │  (routes)   │  │ (events)  │──┤  ChordGenerator        │  │
│  └─────────────┘  └───────────┘  │  (DistilGPT-2)         │  │
│                                  └────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐                          │
│  │  midi_out.py │  │ standards.py │                          │
│  │  (rtmidi)    │  │ (MusicXML)   │                          │
│  └──────┬───────┘  └──────────────┘                          │
│         └──── Virtual MIDI port ──▶ DAW                      │
└──────────────────────────────────────────────────────────────┘
```

### Coordinate System

The torus is parameterised by two angles:

- **θ (theta)** — Circle of Fifths position (C → G → D → … → F), mapped around the ring (0 → 2π)
- **φ (phi)** — Chord quality/tension (Major → Suspended → Dominant → Minor → Augmented → Diminished), mapped around the tube

Parametric equations:

$$
x = (R + r \cos\varphi)\cos\theta \qquad
y = (R + r \cos\varphi)\sin\theta \qquad
z = r \sin\varphi
$$

With $R = 3.0$ (major radius) and $r = 1.2$ (tube radius).

### Quality Families

| Family | φ Range | Colour | Example Qualities |
|---|---|---|---|
| Major | 0 – π/4 | Blue | maj, maj7, 6, add9 |
| Suspended | π/4 – π/2 | Teal | sus4, sus2, 7sus4 |
| Dominant | π/2 – π | Amber | 7, 9, 13, 7♯9 |
| Minor | π – 5π/4 | Rose | m, m7, m9, m6, mMaj7 |
| Augmented | 5π/4 – 3π/2 | Purple | aug, aug7 |
| Diminished | 3π/2 – 2π | Slate | dim, dim7, m7♭5 |

---

## Project Structure

```
sonabe/
├── run.py                      # Entry point — starts the server
├── requirements.txt            # Python dependencies
├── Dockerfile                  # Docker image for Hugging Face Spaces
├── server/                     # Backend (Python)
│   ├── __init__.py
│   ├── app.py                  # Flask + SocketIO routes & events
│   ├── inference.py            # DistilGPT-2 generator, torus mapping, voicings
│   ├── midi_out.py             # Virtual MIDI port → DAW (via python-rtmidi)
│   └── standards.py            # MusicXML parser for jazz standards
├── client/                     # Frontend (static assets)
│   ├── index.html              # Main HTML page
│   ├── favicon.svg             # App icon
│   ├── audio/                  # WAV drum samples (generated)
│   ├── css/
│   │   └── style.css           # Glassmorphic dark UI theme
│   └── js/
│       ├── chord-map.js        # Client-side torus math (mirrors inference.py)
│       ├── synth.js            # Web Audio Rhodes synth + voice leading
│       ├── drums.js            # Drum machine — 5 jazz styles, WAV playback
│       └── main.js             # Three.js scene, raycasting, Socket.IO client
├── data/                       # Jazz standards (MusicXML files)
├── models/
│   └── distilgpt2_jazz_final/  # Fine-tuned model checkpoint
│       ├── config.json
│       ├── generation_config.json
│       ├── model.safetensors
│       └── tokens.npy          # Custom ~198-token vocabulary
├── training/                   # Model training pipeline (reference)
│   ├── config.py               # Hyperparameters & paths
│   ├── dataset.py              # Dataset preparation
│   └── train.py                # Training script
└── generate_drums.py           # Script to regenerate WAV drum samples
```

---

## Getting Started

### Prerequisites

- **Python 3.10+**
- **pip** (or conda)
- A **GPU** is recommended for faster inference but not required (CPU works)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/sonabe.git
cd sonabe
```

### 2. Create a virtual environment

```bash
python -m venv .venv
source .venv/bin/activate   # Linux / macOS
# .venv\Scripts\activate    # Windows
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Place the model

Ensure the fine-tuned model files are in `models/distilgpt2_jazz_final/`:

```
models/distilgpt2_jazz_final/
├── config.json
├── generation_config.json
├── model.safetensors
└── tokens.npy
```

### 5. Run the server

```bash
python run.py
```

Open **http://localhost:5000** in your browser.

### Docker (Hugging Face Spaces)

```bash
docker build -t sonabe .
docker run -p 7860:7860 sonabe
```

Open **http://localhost:7860**.

---

## 🎹 Audio Engine

The built-in synthesiser (`synth.js`) creates a Rhodes-like electric piano sound:

- **Dual oscillators** per voice: sine + triangle with 6-cent detuning for warmth
- **ADSR envelope**: attack 60 ms, decay 150 ms, sustain 0.55, release 1.8 s
- **Voice leading**: bass note stays fixed; upper voices are octave-shifted (±12 semitones) to minimise total pitch movement from the previous chord
- **Humanisation**: slight random stagger (0–15 ms) and velocity variation per note
- **Effects**: dynamic compressor → procedural convolution reverb → master gain

### Drum Machine

Five jazz rhythm styles with procedurally generated WAV samples:

| Style | BPM | Character |
|---|---|---|
| Swing | 140 | Classic jazz swing with ride cymbal |
| Bossa Nova | 130 | Brazilian groove with soft brushes |
| Bebop | 180 | Fast, driving rhythm |
| Ballad | 72 | Slow, spacious brushwork |
| Latin | 110 | Afro-Cuban influenced patterns |

---

## DAW Integration (MIDI Output)

Sonabe creates a **virtual MIDI port** named **"Sonabe"** using `python-rtmidi`. Any DAW on the same machine can receive the generated chord voicings as standard MIDI note-on/note-off messages.

### Platform Setup

| Platform | Setup |
|---|---|
| **Linux (ALSA)** | Works out of the box — virtual port appears automatically |
| **macOS (CoreMIDI)** | Works out of the box — verify in *Audio MIDI Setup* |
| **Windows** | Requires [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) — create a port named `Sonabe` |

### Connecting to your DAW

1. Start Sonabe: `python run.py`
2. In your DAW, create a new MIDI track
3. Set the MIDI input to **"Sonabe"**
4. Load a virtual instrument (piano, Rhodes, strings — anything!)
5. Arm the track for recording
6. Press `I` or click **MIDI** to enable output, then press `Space` to start
7. The DAW will receive each chord as MIDI note messages

---

## Model Details

| Parameter | Value |
|---|---|
| Base model | `distilgpt2` (Hugging Face) |
| Vocabulary | ~198 custom tokens (roots, qualities, alterations, durations, styles, forms) |
| Context window | 1 024 tokens |
| Fine-tuning epochs | 10 |
| Batch size | 32 |
| Learning rate | 2 × 10⁻⁴ |
| Generation | temperature=0.9, top-k=40, top-p=0.92 |

The vocabulary is **decomposed**: the model does not output complete chord symbols like `Dm7` as single tokens. Instead it outputs separate tokens (`D`, `m7`, `add b9`) that are reassembled by a stateful parser in `inference.py`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Flask, Flask-SocketIO, eventlet |
| **AI** | PyTorch, Hugging Face Transformers (DistilGPT-2) |
| **MIDI** | mido + python-rtmidi (virtual MIDI port → DAW) |
| **3-D Rendering** | Three.js 0.160.0 (ES modules via importmap), CSS2DRenderer, UnrealBloomPass |
| **Audio** | Web Audio API (custom Rhodes synth + WAV drum machine) |
| **Real-time** | Socket.IO (WebSocket transport) |
| **Styling** | Glassmorphic dark theme, JetBrains Mono + Inter fonts |
| **Deployment** | Docker (Hugging Face Spaces compatible) |

---

## License

This project was developed as part of the *Generative Algorithms for Sound and Music* course (SMC Master's programme, Universitat Pompeu Fabra).
