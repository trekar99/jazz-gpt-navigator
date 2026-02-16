/**
 * ═══════════════════════════════════════════════════════════════
 *  Sonabe — Jazz GPT Navigator  ·  Three.js Scene
 * ═══════════════════════════════════════════════════════════════
 *  Renders a Tonal Torus with scaffold chord nodes, CSS2D chord
 *  labels, a navigator orb, particle starfield, bloom post-
 *  processing, and raycasting tooltips.  Connects to the Flask-
 *  SocketIO server for real-time chord streaming and plays each
 *  chord via the Web Audio synth.
 * ═══════════════════════════════════════════════════════════════
 */

import * as THREE from "three";
import { OrbitControls }          from "three/addons/controls/OrbitControls.js";
import { EffectComposer }         from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass }             from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass }        from "three/addons/postprocessing/UnrealBloomPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/* ── DOM refs ─────────────────────────────────────────────────── */
const container  = document.getElementById("three-canvas");
const elName     = document.getElementById("chord-name");
const elQuality  = document.getElementById("chord-quality");
const elTrack    = document.getElementById("progression-track");
const elTooltip  = document.getElementById("tooltip");
const elTTName   = document.getElementById("tooltip-name");
const elTTQual   = document.getElementById("tooltip-quality");
const elNextPreview = document.getElementById("next-preview");
const elNextName    = document.getElementById("next-name");

/* ── Scene essentials ─────────────────────────────────────────── */
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
container.appendChild(renderer.domElement);

/* ── CSS2D label renderer ─────────────────────────────────────── */
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.top = "0";
labelRenderer.domElement.style.left = "0";
labelRenderer.domElement.style.pointerEvents = "none";
container.appendChild(labelRenderer.domElement);

/* ── Controls ─────────────────────────────────────────────────── */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;
controls.autoRotate     = false;
controls.minDistance     = 3;
controls.maxDistance     = 25;

/* ── Post-processing (bloom) ──────────────────────────────────── */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.4, 0.4
);
composer.addPass(bloom);

/* ── Lights ───────────────────────────────────────────────────── */
scene.add(new THREE.AmbientLight(0x303050, 1.2));
const dirLight = new THREE.DirectionalLight(0x8888ff, 0.6);
dirLight.position.set(5, 10, 5);
scene.add(dirLight);

/* ═══════════════════════════════════════════════════════════════
   Starfield particles
   ═══════════════════════════════════════════════════════════════ */
function buildStarfield(count = 2000) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
        pos[i] = (Math.random() - 0.5) * 120;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
        color: 0x667799, size: 0.08, sizeAttenuation: true,
        transparent: true, opacity: 0.6,
    });
    return new THREE.Points(geo, mat);
}
scene.add(buildStarfield());

/* ═══════════════════════════════════════════════════════════════
   Torus wireframe
   ═══════════════════════════════════════════════════════════════ */
function buildTorus() {
    const geo = new THREE.TorusGeometry(ChordMap.R, ChordMap.r, 64, 128);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x2244aa, wireframe: true,
        transparent: true, opacity: 0.12,
        roughness: 0.7, metalness: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;   // align with scaffold coord swap
    return mesh;
}
const torus = buildTorus();
scene.add(torus);

/* ═══════════════════════════════════════════════════════════════
   Guide rings — one per root note on the Circle of Fifths
   ═══════════════════════════════════════════════════════════════ */
function buildGuideRings() {
    const group = new THREE.Group();
    for (const { root, theta } of ChordMap.buildRootRing("maj7")) {
        const segments = 64;
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const phi = (i / segments) * Math.PI * 2;
            const p = ChordMap.torusToXYZ(theta, phi);
            points.push(new THREE.Vector3(p.x, p.z, p.y));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color: new THREE.Color().setHSL(ChordMap.rootHue(root) / 360, 0.5, 0.35),
            transparent: true, opacity: 0.2,
        });
        group.add(new THREE.Line(geo, mat));
    }
    return group;
}
scene.add(buildGuideRings());

/* ═══════════════════════════════════════════════════════════════
   Scaffold nodes — interactive chord spheres + CSS2D labels
   ═══════════════════════════════════════════════════════════════ */
const scaffoldGroup = new THREE.Group();
const scaffoldNodes = [];
const scaffoldGeo = new THREE.SphereGeometry(0.06, 12, 12);

function buildScaffold() {
    for (const pt of ChordMap.buildScaffold()) {
        // Colour by quality family (not root hue)
        const hsl = new THREE.Color().setHSL(
            pt.familyHue / 360, pt.familySat, pt.familyLit
        );
        const mat = new THREE.MeshStandardMaterial({
            color: hsl, emissive: hsl, emissiveIntensity: 0.25,
            transparent: true, opacity: 0.55,
            roughness: 0.4, metalness: 0.3,
        });
        const mesh = new THREE.Mesh(scaffoldGeo, mat);
        // Coordinate swap: math(x,y,z) → Three.js(x,z,y)
        mesh.position.set(pt.x, pt.z, pt.y);
        scaffoldGroup.add(mesh);

        // CSS2D chord name label
        const div = document.createElement("div");
        div.className = "chord-label";
        div.textContent = pt.name;
        div.style.color = hsl.getStyle();
        const label = new CSS2DObject(div);
        label.position.set(0, 0.12, 0);   // Slight offset above node
        label.layers.set(0);
        mesh.add(label);

        scaffoldNodes.push({ mesh, data: pt, label });
    }
}
buildScaffold();
scene.add(scaffoldGroup);

/* ═══════════════════════════════════════════════════════════════
   Navigator orb — glowing sphere that moves to the active chord
   ═══════════════════════════════════════════════════════════════ */
const navOrb = (() => {
    const geo = new THREE.SphereGeometry(0.18, 32, 32);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x5ea8ff, emissive: 0x3388ff,
        emissiveIntensity: 1.5,
        transparent: true, opacity: 0.95,
        roughness: 0.1, metalness: 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;

    // Glow sprite
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const c2d = canvas.getContext("2d");
    const grad = c2d.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0,   "rgba(94,168,255,0.6)");
    grad.addColorStop(0.5, "rgba(94,168,255,0.15)");
    grad.addColorStop(1,   "rgba(94,168,255,0)");
    c2d.fillStyle = grad;
    c2d.fillRect(0, 0, 64, 64);
    const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true, opacity: 0.8, depthWrite: false,
        })
    );
    glow.scale.set(1.6, 1.6, 1);
    mesh.add(glow);

    // Riding point light
    mesh.add(new THREE.PointLight(0x5ea8ff, 2, 5));

    scene.add(mesh);
    return mesh;
})();

/* ─ Smooth orb movement ──────────────────────────────────────── */
const navTarget = new THREE.Vector3();
let navLerping = false;

function moveNavigator(coords, root) {
    navTarget.set(coords[0], coords[2], coords[1]);
    navOrb.visible = true;
    navLerping = true;
    // Dynamically colour the orb to match the chord's root hue
    if (root !== undefined) {
        const hue = ChordMap.rootHue(root);
        const col = new THREE.Color().setHSL(hue / 360, 0.7, 0.6);
        navOrb.material.color.copy(col);
        navOrb.material.emissive.copy(col);
        for (const child of navOrb.children) {
            if (child.isPointLight) child.color.copy(col);
            if (child.isSprite) child.material.color.copy(col);
        }
    }
}

/* ═══════════════════════════════════════════════════════════════
   Ghost orb — preview of the next predicted chord
   ═══════════════════════════════════════════════════════════════ */
const ghostOrb = (() => {
    const geo = new THREE.SphereGeometry(0.14, 24, 24);
    const mat = new THREE.MeshStandardMaterial({
        color: 0xffc44d, emissive: 0xffa500,
        emissiveIntensity: 0.8,
        transparent: true, opacity: 0.35,
        roughness: 0.3, metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;

    // Soft glow sprite
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const c2d = canvas.getContext("2d");
    const grad = c2d.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0,   "rgba(255,196,77,0.35)");
    grad.addColorStop(0.5, "rgba(255,196,77,0.08)");
    grad.addColorStop(1,   "rgba(255,196,77,0)");
    c2d.fillStyle = grad;
    c2d.fillRect(0, 0, 64, 64);
    const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true, opacity: 0.5, depthWrite: false,
        })
    );
    glow.scale.set(1.2, 1.2, 1);
    mesh.add(glow);

    scene.add(mesh);
    return mesh;
})();

const ghostTarget = new THREE.Vector3();
let ghostLerping = false;

function moveGhost(coords, root) {
    ghostTarget.set(coords[0], coords[2], coords[1]);
    ghostOrb.visible = true;
    ghostLerping = true;
    // Dynamically colour the ghost to match the preview chord's root hue
    if (root !== undefined) {
        const hue = ChordMap.rootHue(root);
        const col = new THREE.Color().setHSL(hue / 360, 0.55, 0.6);
        ghostOrb.material.color.copy(col);
        ghostOrb.material.emissive.copy(col);
        for (const child of ghostOrb.children) {
            if (child.isSprite) child.material.color.copy(col);
        }
    }
}

function hideGhost() {
    ghostOrb.visible = false;
    ghostLerping = false;
}

/* ═══════════════════════════════════════════════════════════════
   Trail — fading line behind the navigator, colored by chord
   ═══════════════════════════════════════════════════════════════ */
const MAX_TRAIL = 60;
const trailPositions = new Float32Array(MAX_TRAIL * 3);
const trailColors    = new Float32Array(MAX_TRAIL * 3);   // per-vertex RGB
let trailLen = 0;
let _lastChordHue = 210;   // default blue until first chord
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
trailGeo.setAttribute("color",    new THREE.BufferAttribute(trailColors, 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.45,
}));
scene.add(trail);

function addTrailPoint(x, y, z) {
    if (trailLen >= MAX_TRAIL) {
        trailPositions.copyWithin(0, 3);
        trailColors.copyWithin(0, 3);
        trailLen = MAX_TRAIL - 1;
    }
    const i = trailLen * 3;
    trailPositions[i] = x;
    trailPositions[i + 1] = y;
    trailPositions[i + 2] = z;
    // Convert HSL hue to RGB for the vertex colour
    const c = new THREE.Color().setHSL(_lastChordHue / 360, 0.65, 0.6);
    trailColors[i]     = c.r;
    trailColors[i + 1] = c.g;
    trailColors[i + 2] = c.b;
    trailLen++;
    trailGeo.setDrawRange(0, trailLen);
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
}

/* ═══════════════════════════════════════════════════════════════
   Raycasting — tooltip on hover
   ═══════════════════════════════════════════════════════════════ */
const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.1 };
const mouse = new THREE.Vector2();
let hoveredNode = null;

function onPointerMove(e) {
    mouse.x =  (e.clientX / innerWidth)  * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const meshes = scaffoldNodes.map(n => n.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
        const hit  = hits[0].object;
        const node = scaffoldNodes.find(n => n.mesh === hit);
        if (node && node !== hoveredNode) {
            unhover();
            hoveredNode = node;
            node.mesh.material.emissiveIntensity = 1.0;
            node.mesh.material.opacity = 1;
            node.mesh.scale.setScalar(1.8);
        }
        if (node) {
            const label = ChordMap.QUALITY_LABELS[node.data.quality] || node.data.quality;
            elTTName.textContent    = node.data.name;
            elTTQual.textContent    = label;
            elTooltip.style.left    = `${e.clientX + 14}px`;
            elTooltip.style.top     = `${e.clientY - 10}px`;
            elTooltip.classList.add("visible");
        }
    } else {
        unhover();
    }
}

function unhover() {
    if (hoveredNode) {
        // In discover mode, don't reset to default — restore probability appearance
        if (discoverMode) {
            applyDiscoverAppearance(hoveredNode);
        } else {
            hoveredNode.mesh.material.emissiveIntensity = 0.25;
            hoveredNode.mesh.material.opacity = 0.55;
            hoveredNode.mesh.scale.setScalar(1);
        }
        hoveredNode = null;
    }
    elTooltip.classList.remove("visible");
}

window.addEventListener("pointermove", onPointerMove, { passive: true });

/* ── Click handler for Discover mode ──────────────────────────── */
window.addEventListener("click", (e) => {
    if (!discoverMode) return;
    // Ignore clicks on UI elements
    if (e.target.closest("#controls, .glass, .modal-overlay")) return;

    raycaster.setFromCamera(mouse, camera);
    const meshes = scaffoldNodes.map(n => n.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
        const hit  = hits[0].object;
        const node = scaffoldNodes.find(n => n.mesh === hit);
        if (node) {
            Synth.ensureContext();
            socket.emit("discover_chord", { chord: node.data.name });
        }
    }
});

/* ═══════════════════════════════════════════════════════════════
   Socket.IO — real-time chord events
   ═══════════════════════════════════════════════════════════════ */
const socket = io();

socket.on("connect", () => console.log("Sonabe connected"));
socket.on("disconnect", () => console.log("Sonabe disconnected"));

socket.on("generation_status", ({ active }) => {
    document.getElementById("btn-start").disabled = active;
    document.getElementById("btn-stop").disabled  = !active;
    document.getElementById("btn-step").disabled  = active;  // no stepping while auto-playing
});

/* ── Loop state ────────────────────────────────────────────────── */
const progressionChords = [];   // chord names collected during generation
let looping = false;

socket.on("new_chord", (ev) => {
    updateHUD(ev);
    _lastChordHue = ChordMap.rootHue(ev.root);   // colour the next trail segment
    moveNavigator(ev.coordinates, ev.root);

    if (looping) {
        // During loop: just highlight the matching chip, don't add new ones
        highlightLoopChip(ev.index);
    } else {
        addProgressionChip(ev.name, ev.index);
        progressionChords.push(ev.name);
        btnLoop.disabled = false;   // at least 1 chord → enable loop
    }

    // ♫ Play the chord via Web Audio synth
    if (ev.midi && ev.midi.length > 0) {
        Synth.playChord(ev.midi);
    }

    // 🥁 Trigger one bar of drums aligned to this chord
    if (Drums.isActive()) {
        Drums.playBar(Drums.getBarDuration());
    }
});

socket.on("progression_reset", () => {
    resetUI();
});

/* ── Next-chord preview ────────────────────────────────────── */
let previewEnabled = false;

socket.on("next_preview", (ev) => {
    if (!previewEnabled || !ev || discoverMode) {
        clearPreview();
        return;
    }
    elNextName.textContent = ev.name;
    const hue = ChordMap.rootHue(ev.root);
    elNextName.style.color = `hsl(${hue}, 60%, 70%)`;
    elNextPreview.classList.remove("hidden");
    if (ev.coordinates) moveGhost(ev.coordinates, ev.root);
});

function clearPreview() {
    elNextPreview.classList.add("hidden");
    elNextName.textContent = "—";
    hideGhost();
}

/* ── Preview toggle button ────────────────────────────────────── */
const btnPreview      = document.getElementById("btn-preview");
const previewBtnLabel = document.getElementById("preview-btn-label");

btnPreview.addEventListener("click", () => {
    previewEnabled = !previewEnabled;
    btnPreview.classList.toggle("preview-on", previewEnabled);
    previewBtnLabel.textContent = previewEnabled ? "Preview ✓" : "Preview";
    socket.emit("toggle_preview", { enabled: previewEnabled });
    if (!previewEnabled) clearPreview();
});

/* ── Button wiring ────────────────────────────────────────────── */
document.getElementById("btn-start").addEventListener("click", () => {
    Synth.ensureContext();   // Needs user gesture
    if (discoverMode) exitDiscoverMode();
    if (looping) socket.emit("stop_loop");
    socket.emit("start_generation");
});
document.getElementById("btn-stop").addEventListener("click",  () => socket.emit("stop_generation"));
document.getElementById("btn-step").addEventListener("click",  () => {
    Synth.ensureContext();
    if (discoverMode) exitDiscoverMode();
    socket.emit("request_chord");
});
document.getElementById("btn-reset").addEventListener("click", () => {
    if (discoverMode) exitDiscoverMode();
    if (looping) socket.emit("stop_loop");
    socket.emit("reset_progression");
});

// Mute / unmute
const btnMute      = document.getElementById("btn-mute");
const iconUnmuted  = document.getElementById("icon-unmuted");
const iconMuted    = document.getElementById("icon-muted");

btnMute.addEventListener("click", () => {
    const muted = Synth.toggleMute();
    iconUnmuted.style.display = muted ? "none" : "";
    iconMuted.style.display   = muted ? ""     : "none";
    btnMute.classList.toggle("muted", muted);
});

/* ── MIDI output controls ─────────────────────────────────────── */
const btnMidi      = document.getElementById("btn-midi");
const midiDot      = document.getElementById("midi-dot");
const midiPortName = document.getElementById("midi-port-name");
let midiEnabled    = false;

// Toggle MIDI on/off
btnMidi.addEventListener("click", () => {
    socket.emit(midiEnabled ? "midi_disable" : "midi_enable");
});

// Server pushes MIDI status updates
socket.on("midi_status", (status) => {
    midiEnabled = status.enabled;
    btnMidi.classList.toggle("midi-on", status.enabled);
    midiDot.className = "midi-dot " + (status.enabled ? "on" : "off");
    midiPortName.textContent = status.enabled
        ? `${status.port_name}`
        : status.available ? "Disconnected" : "Not available";
    document.getElementById("midi-btn-label").textContent =
        status.enabled ? "MIDI ✓" : "MIDI";
});

/* ── Rhythm / drum machine controls ───────────────────────────── */
const btnRhythm       = document.getElementById("btn-rhythm");
const rhythmBtnLabel  = document.getElementById("rhythm-btn-label");
const rhythmDropdown  = document.getElementById("rhythm-dropdown");
let rhythmActive      = false;
let activeRhythmStyle = null;

// Build dropdown items from Drums engine
const rhythmStyles = Drums.getStyles();
for (let ri = 0; ri < rhythmStyles.length; ri++) {
    const s = rhythmStyles[ri];
    const item = document.createElement("div");
    item.className = "rhythm-dd-item";
    item.dataset.style = s.key;
    item.innerHTML = `<span class="rhythm-dd-num">${ri + 1}</span>${s.label} <span class="rhythm-dd-bpm">${s.bpm} bpm</span>`;
    item.addEventListener("click", (e) => {
        e.stopPropagation();
        selectRhythm(s.key);
    });
    rhythmDropdown.appendChild(item);
}

btnRhythm.addEventListener("click", () => {
    if (rhythmActive) {
        stopRhythm();
    } else {
        // Toggle dropdown visibility
        rhythmDropdown.classList.toggle("hidden");
    }
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest("#rhythm-group")) {
        rhythmDropdown.classList.add("hidden");
    }
});

function selectRhythm(styleKey) {
    Synth.ensureContext();
    activeRhythmStyle = styleKey;
    rhythmActive = true;

    // Update dropdown highlight
    rhythmDropdown.querySelectorAll(".rhythm-dd-item").forEach(el => {
        el.classList.toggle("active", el.dataset.style === styleKey);
    });

    // Update button
    const info = Drums.getStyles().find(s => s.key === styleKey);
    rhythmBtnLabel.textContent = info ? info.label : "Rhythm";
    btnRhythm.classList.add("rhythm-on");

    // Enable (arm) the drum engine with chosen style
    Drums.enable(styleKey);

    // Tell the server to adjust chord emission speed to this BPM
    socket.emit("set_tempo", { bpm: Drums.getBPM() });

    rhythmDropdown.classList.add("hidden");
}

/* ── Temperature slider (color-coded) ──────────────────────────── */
const tempSlider = document.getElementById("temp-slider");
const tempValue  = document.getElementById("temp-value");
const tempGroup  = document.getElementById("temp-group");

/**
 * Map a temperature value to an HSL colour string.
 *   0.1 → cool blue (210°)   →   1.0 → green (120°)
 *   1.0 → green (120°)       →   2.5 → hot red (0°)
 */
function tempToColor(t) {
    t = Math.max(0.1, Math.min(2.5, t));
    let hue;
    if (t <= 1.0) {
        // 0.1–1.0  →  blue(210) → green(120)
        const f = (t - 0.1) / 0.9;
        hue = 210 - f * 90;           // 210→120
    } else {
        // 1.0–2.5  →  green(120) → red(0)
        const f = (t - 1.0) / 1.5;
        hue = 120 - f * 120;          // 120→0
    }
    return `hsl(${Math.round(hue)}, 75%, 55%)`;
}

function updateTempColor() {
    const val = parseFloat(tempSlider.value);
    const color = tempToColor(val);
    const glow  = color.replace('55%)', '40%)').replace('hsl', 'hsla').replace(')', ', 0.5)');
    tempGroup.style.setProperty("--temp-color", color);
    tempGroup.style.setProperty("--temp-glow", glow);
    tempValue.textContent = val.toFixed(2);
}

tempSlider.addEventListener("input", () => {
    updateTempColor();
    socket.emit("set_temperature", { temperature: parseFloat(tempSlider.value) });
});

// Set initial colour
updateTempColor();

/* ── Loop controls ─────────────────────────────────────────────── */
const btnLoop      = document.getElementById("btn-loop");
const loopBtnLabel = document.getElementById("loop-btn-label");

btnLoop.addEventListener("click", () => {
    Synth.ensureContext();
    if (looping) {
        // Stop the loop
        socket.emit("stop_loop");
    } else {
        // Start looping the current progression
        if (progressionChords.length === 0) return;
        socket.emit("stop_generation");
        socket.emit("start_loop", { chords: [...progressionChords] });
    }
});

// Server tells us loop state changed
socket.on("loop_status", ({ looping: active, count }) => {
    looping = active;
    btnLoop.classList.toggle("loop-on", active);
    loopBtnLabel.textContent = active
        ? `Loop (${count || progressionChords.length})`
        : "Loop";
    // While looping, keep the button enabled so user can stop
    if (active) btnLoop.disabled = false;
});

function stopRhythm() {
    Drums.disable();
    rhythmActive = false;
    activeRhythmStyle = null;
    btnRhythm.classList.remove("rhythm-on");
    rhythmBtnLabel.textContent = "Rhythm";
    // Reset server to default tempo
    socket.emit("set_tempo", { bpm: 120 });
    rhythmDropdown.querySelectorAll(".rhythm-dd-item").forEach(el => {
        el.classList.remove("active");
    });
}

/* ── "More" dropdown toggle ────────────────────────────────────── */
const btnMore      = document.getElementById("btn-more");
const moreDropdown = document.getElementById("more-dropdown");

btnMore.addEventListener("click", () => {
    moreDropdown.classList.toggle("hidden");
});

// Close "More" dropdown when clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest("#more-group")) {
        moreDropdown.classList.add("hidden");
    }
});

/* -- Info panel toggle -- */
const btnInfo = document.getElementById("btn-info");
const infoOverlay = document.getElementById("info-overlay");
const btnCloseInfo = document.getElementById("btn-close-info");

function toggleInfoPanel() {
    infoOverlay.classList.toggle("hidden");
}

function closeInfoPanel() {
    infoOverlay.classList.add("hidden");
}

btnInfo.addEventListener("click", toggleInfoPanel);
btnCloseInfo.addEventListener("click", closeInfoPanel);

// Close info panel when clicking outside
infoOverlay.addEventListener("click", (e) => {
    if (e.target === infoOverlay) closeInfoPanel();
});

// Show info panel on load
document.addEventListener("DOMContentLoaded", () => {
    infoOverlay.classList.remove("hidden");
});

/* ── Keyboard shortcuts ────────────────────────────────────────── */
document.addEventListener("keydown", (e) => {
    // Ignore when typing in an input or the standards modal is open
    if (e.target.closest("input, textarea, select")) return;
    const stdOverlay = document.getElementById("standards-overlay");
    if (!stdOverlay.classList.contains("hidden")) return;

    const key = e.key.toLowerCase();

    switch (e.code) {
        // ─── Space — start / stop generation ──────────────
        case "Space":
            e.preventDefault();
            if (!document.getElementById("btn-stop").disabled)
                document.getElementById("btn-stop").click();
            else if (!document.getElementById("btn-start").disabled)
                document.getElementById("btn-start").click();
            break;

        // ─── ArrowLeft / ArrowRight — temperature ────────
        case "ArrowLeft":
            e.preventDefault();
            tempSlider.value = Math.max(
                parseFloat(tempSlider.min),
                parseFloat(tempSlider.value) - 0.05
            ).toFixed(2);
            tempSlider.dispatchEvent(new Event("input"));
            break;
        case "ArrowRight":
            e.preventDefault();
            tempSlider.value = Math.min(
                parseFloat(tempSlider.max),
                parseFloat(tempSlider.value) + 0.05
            ).toFixed(2);
            tempSlider.dispatchEvent(new Event("input"));
            break;
    }

    // ─── Letter-key shortcuts ────────────────────────────
    switch (key) {
        case "a":   // Step — next chord
            document.getElementById("btn-step").click();
            break;
        case "r":   // Reset
            document.getElementById("btn-reset").click();
            break;
        case "m":   // Mute / unmute sound
            btnMute.click();
            break;
        case "t":   // Reset temperature to default (0.9)
            tempSlider.value = 0.9;
            tempSlider.dispatchEvent(new Event("input"));
            break;
        case "l":   // Loop toggle
            if (!btnLoop.disabled) btnLoop.click();
            break;
        case "p":   // Preview toggle
            btnPreview.click();
            break;
        case "i":   // MIDI toggle
            btnMidi.click();
            break;
        case "d":   // Discover mode toggle
            btnDiscover.click();
            break;
        case "s":   // Standards browser
            e.preventDefault();
            btnStandards.click();
            break;
        case "h":   // Info panel
            toggleInfoPanel();
            break;
        case "0":   // Stop rhythm
            if (rhythmActive) stopRhythm();
            break;
    }

    // ─── Number keys 1-5 — select rhythm style ──────────
    const num = parseInt(key);
    if (num >= 1 && num <= rhythmStyles.length) {
        const style = rhythmStyles[num - 1];
        if (rhythmActive && activeRhythmStyle === style.key) {
            stopRhythm();          // toggle off if same style
        } else {
            selectRhythm(style.key);
        }
    }
});

/* ── Server state sync on (re)connect ──────────────────────────── */
socket.on("server_state", (state) => {
    // Sync preview toggle
    if (typeof state.preview_enabled === "boolean") {
        previewEnabled = state.preview_enabled;
        btnPreview.classList.toggle("preview-on", previewEnabled);
        previewBtnLabel.textContent = previewEnabled ? "Preview ✓" : "Preview";
        if (!previewEnabled) clearPreview();
    }
    // Sync temperature slider
    if (typeof state.temperature === "number") {
        tempSlider.value = state.temperature;
        updateTempColor();
    }
});

/* ── Jazz Standards Browser ───────────────────────────────────── */
const btnStandards       = document.getElementById("btn-standards");
const standardsOverlay   = document.getElementById("standards-overlay");
const standardsList      = document.getElementById("standards-list");
const standardsSearch    = document.getElementById("standards-search");
const standardsCount     = document.getElementById("standards-count");
const btnCloseStandards  = document.getElementById("btn-close-standards");
const standardInfo       = document.getElementById("standard-info");
const standardBar        = document.getElementById("standard-bar");
const standardBarTitle   = document.getElementById("standard-bar-title");
const standardBarMeta    = document.getElementById("standard-bar-meta");
const btnPlayStandard    = document.getElementById("btn-play-standard");

let allStandards   = [];
let selectedStd    = null;
let standardLoaded = false;

// Standards button: open modal if no standard loaded, clear if one is
btnStandards.addEventListener("click", () => {
    if (standardLoaded) {
        // Clear the current standard
        socket.emit("clear_standard");
        return;
    }
    standardsOverlay.classList.remove("hidden");
    standardsSearch.value = "";
    standardsSearch.focus();
    if (allStandards.length === 0) {
        socket.emit("list_standards");
    } else {
        renderStandardsList(allStandards);
    }
});

// Close modal
btnCloseStandards.addEventListener("click", closeStandardsModal);
standardsOverlay.addEventListener("click", (e) => {
    if (e.target === standardsOverlay) closeStandardsModal();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        // Close standards modal
        if (!standardsOverlay.classList.contains("hidden")) {
            closeStandardsModal();
        }
        // Exit standard jazz mode (clear loaded standard)
        else if (standardLoaded) {
            socket.emit("clear_standard");
        }
        // Close info panel
        if (!infoOverlay.classList.contains("hidden")) {
            closeInfoPanel();
        }
        // Exit discover mode
        if (discoverMode) {
            exitDiscoverMode();
        }
    }
    if (e.key === "Enter" && standardLoaded && !btnPlayStandard.disabled) {
        e.preventDefault();
        btnPlayStandard.click();
    }
});

function closeStandardsModal() {
    standardsOverlay.classList.add("hidden");
}

// Receive standards list from server
socket.on("standards_list", (list) => {
    allStandards = list;
    standardsCount.textContent = list.length.toLocaleString();
    renderStandardsList(list);
});

// Search / filter
standardsSearch.addEventListener("input", () => {
    const q = standardsSearch.value.toLowerCase().trim();
    if (!q) {
        renderStandardsList(allStandards);
        return;
    }
    const filtered = allStandards.filter(s =>
        s.title.toLowerCase().includes(q)
    );
    renderStandardsList(filtered);
});

function renderStandardsList(list) {
    standardsList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    // Limit rendering to 200 for performance
    const slice = list.slice(0, 200);
    for (const std of slice) {
        const li = document.createElement("li");
        li.innerHTML = `<span class="std-icon">♪</span>${escapeHtml(std.title)}`;
        li.addEventListener("click", () => selectStandard(std, li));
        fragment.appendChild(li);
    }
    standardsList.appendChild(fragment);
    if (list.length > 200) {
        const more = document.createElement("li");
        more.style.color = "var(--text-dim)";
        more.style.cursor = "default";
        more.style.fontStyle = "italic";
        more.textContent = `… and ${list.length - 200} more — refine your search`;
        standardsList.appendChild(more);
    }
}

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function selectStandard(std, li) {
    // Highlight selected
    const prev = standardsList.querySelector("li.selected");
    if (prev) prev.classList.remove("selected");
    li.classList.add("selected");
    selectedStd = std;

    // Load it
    socket.emit("load_standard", { filename: std.filename });
    standardInfo.innerHTML = `<span>Loading <strong>${escapeHtml(std.title)}</strong>…</span>`;
}

// Standard loaded confirmation
socket.on("standard_loaded", (meta) => {
    standardLoaded = true;
    selectedStd = { ...selectedStd, ...meta };

    // Update modal footer
    const tags = [];
    if (meta.composer) tags.push(`<span class="info-tag">${escapeHtml(meta.composer)}</span>`);
    if (meta.style)    tags.push(`<span class="info-tag">${escapeHtml(meta.style)}</span>`);
    if (meta.key)      tags.push(`<span class="info-tag">${escapeHtml(meta.key)}</span>`);
    tags.push(`<span class="info-tag">${meta.chord_count} chords</span>`);
    standardInfo.innerHTML = `✓ Loaded — ${tags.join("")}`;

    // Show standard bar
    standardBarTitle.textContent = meta.title;
    const parts = [];
    if (meta.composer) parts.push(meta.composer);
    if (meta.key) parts.push(meta.key);
    if (meta.style) parts.push(meta.style);
    standardBarMeta.textContent = parts.join(" · ");
    standardBar.classList.remove("hidden");

    // Update button state
    btnStandards.classList.add("std-active");
    document.getElementById("standards-btn-label").textContent = "✕ Clear";

    closeStandardsModal();
});

socket.on("standard_cleared", () => {
    standardLoaded = false;
    selectedStd = null;
    standardBar.classList.add("hidden");
    btnStandards.classList.remove("std-active");
    document.getElementById("standards-btn-label").textContent = "Standards";
    resetUI();
    socket.emit("reset_progression");
});

socket.on("standard_error", (data) => {
    standardInfo.innerHTML = `<span style="color:var(--danger)">✗ ${escapeHtml(data.message)}</span>`;
});

socket.on("standard_finished", () => {
    // Playback finished — re-enable buttons
    document.getElementById("btn-start").disabled = false;
    document.getElementById("btn-stop").disabled = true;
});

// Play standard button
btnPlayStandard.addEventListener("click", () => {
    Synth.ensureContext();
    resetUI();
    socket.emit("play_standard");
});

// Stop also stops standard playback
const origStopHandler = document.getElementById("btn-stop");
// (already wired above in button wiring — stop_generation will also stop standard)

/* ═══════════════════════════════════════════════════════════════
   Discover Mode — interactive chord exploration with probabilities
   ═══════════════════════════════════════════════════════════════ */
const btnDiscover      = document.getElementById("btn-discover");
const discoverBtnLabel = document.getElementById("discover-btn-label");
let discoverMode = false;

btnDiscover.addEventListener("click", () => {
    if (discoverMode) {
        exitDiscoverMode();
    } else {
        enterDiscoverMode();
    }
});

function enterDiscoverMode() {
    discoverMode = true;
    btnDiscover.classList.add("discover-active");
    discoverBtnLabel.textContent = "✕ Exit";

    // Stop any active generation, standard, or loop playback
    socket.emit("stop_generation");
    socket.emit("stop_standard");
    if (looping) socket.emit("stop_loop");

    // Reset progression and scaffold appearance
    socket.emit("reset_progression");
    resetUI();

    // Make all nodes dim to invite clicking
    resetScaffoldAppearance(true);
}

function exitDiscoverMode() {
    discoverMode = false;
    btnDiscover.classList.remove("discover-active");
    discoverBtnLabel.textContent = "Discover";
    resetScaffoldAppearance(false);
}

/**
 * Reset scaffold node appearance.
 * @param {boolean} dimmed  true = discover-mode dimmed state, false = normal
 */
function resetScaffoldAppearance(dimmed) {
    for (const node of scaffoldNodes) {
        if (dimmed) {
            node.mesh.material.emissiveIntensity = 0.08;
            node.mesh.material.opacity = 0.20;
            node.mesh.scale.setScalar(0.7);
            node.label.element.style.opacity = "0.25";
        } else {
            node.mesh.material.emissiveIntensity = 0.25;
            node.mesh.material.opacity = 0.55;
            node.mesh.scale.setScalar(1);
            node.label.element.style.opacity = "";
        }
    }
}

/**
 * Apply discover-mode appearance to a single node based on its probability.
 */
function applyDiscoverAppearance(node) {
    const p = node._discoverProb ?? 0;
    if (p > 0.001) {
        // Remap probabilities for visual range (log-scale for better contrast)
        const t = Math.min(1, Math.pow(p * 20, 0.5));   // non-linear scaling
        node.mesh.material.emissiveIntensity = 0.1 + t * 2.5;
        node.mesh.material.opacity = 0.15 + t * 0.85;
        node.mesh.scale.setScalar(0.6 + t * 1.8);
        node.label.element.style.opacity = String(0.3 + t * 0.7);
    } else {
        node.mesh.material.emissiveIntensity = 0.05;
        node.mesh.material.opacity = 0.10;
        node.mesh.scale.setScalar(0.5);
        node.label.element.style.opacity = "0.15";
    }
}

/**
 * Apply probability heatmap to scaffold nodes.
 */
function applyDiscoverProbabilities(probs) {
    // Assign probability to each node
    for (const node of scaffoldNodes) {
        node._discoverProb = probs[node.data.name] ?? 0;
        applyDiscoverAppearance(node);
    }
}

// Receive probabilities from server
socket.on("discover_probabilities", (probs) => {
    if (!discoverMode) return;
    applyDiscoverProbabilities(probs);
});

/* ═══════════════════════════════════════════════════════════════
   UI helpers
   ═══════════════════════════════════════════════════════════════ */
function updateHUD(ev) {
    elName.textContent    = ev.name;
    elQuality.textContent = ChordMap.QUALITY_LABELS[ev.quality] || ev.quality;
    const hue = ChordMap.rootHue(ev.root);
    elName.style.color = `hsl(${hue}, 70%, 75%)`;
}

function addProgressionChip(name) {
    const chip = document.createElement("span");
    chip.className = "prog-chip active";
    chip.textContent = name;
    const prev = elTrack.querySelector(".prog-chip.active");
    if (prev) prev.classList.remove("active");
    elTrack.appendChild(chip);
    chip.scrollIntoView({ behavior: "smooth", inline: "end" });
}

/**
 * During loop playback, highlight the chip at position `index`
 * without creating any new chips.
 */
function highlightLoopChip(index) {
    const chips = elTrack.querySelectorAll(".prog-chip");
    if (chips.length === 0) return;
    // Remove previous highlight
    const prev = elTrack.querySelector(".prog-chip.active");
    if (prev) prev.classList.remove("active");
    // Highlight the chip at the loop index (wrap around just in case)
    const i = index % chips.length;
    chips[i].classList.add("active");
    chips[i].scrollIntoView({ behavior: "smooth", inline: "center" });
}

function resetUI() {
    elName.textContent    = "—";
    elQuality.textContent = "";
    elName.style.color    = "#fff";
    elTrack.innerHTML     = "";
    navOrb.visible = false;
    navLerping = false;
    trailLen = 0;
    trailGeo.setDrawRange(0, 0);
    trailGeo.attributes.color.needsUpdate = true;
    Synth.resetVoiceLeading();
    // Clear discover probabilities
    for (const node of scaffoldNodes) {
        delete node._discoverProb;
    }
    // Clear loop state
    progressionChords.length = 0;
    btnLoop.disabled = true;
    // Clear preview
    clearPreview();
}

/* ═══════════════════════════════════════════════════════════════
   Animation loop
   ═══════════════════════════════════════════════════════════════ */
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    controls.update();

    // Lerp navigator orb toward target
    if (navLerping) {
        navOrb.position.lerp(navTarget, 1 - Math.pow(0.001, dt));
        if (navOrb.position.distanceTo(navTarget) < 0.01) {
            navOrb.position.copy(navTarget);
            navLerping = false;
            addTrailPoint(navTarget.x, navTarget.y, navTarget.z);
        }
    }

    // Lerp ghost orb toward preview target
    if (ghostLerping) {
        ghostOrb.position.lerp(ghostTarget, 1 - Math.pow(0.01, dt));
        if (ghostOrb.position.distanceTo(ghostTarget) < 0.01) {
            ghostOrb.position.copy(ghostTarget);
            ghostLerping = false;
        }
    }
    // Gentle ghost pulse
    if (ghostOrb.visible) {
        const pulse = 0.25 + 0.12 * Math.sin(clock.elapsedTime * 2.5);
        ghostOrb.material.opacity = pulse;
    }

    // Gentle torus shimmer
    torus.material.opacity = 0.10 + 0.03 * Math.sin(clock.elapsedTime * 0.8);

    composer.render();
    labelRenderer.render(scene, camera);
}
animate();

/* ── Resize handler ───────────────────────────────────────────── */
window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight);
});
