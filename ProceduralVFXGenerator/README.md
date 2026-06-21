# Procedural VFX Generator

A node-based, **zero-dependency** (browser + tiny Node static server) tool for
building procedural particle visual effects, previewing them live, and exporting
them as **sprite sheets** (for Woditor / game engines), **WebM clips**, or PNG
frames.

It is a sibling of the *Procedural SE Generator* and reuses the same
node-editor interaction model (pan/zoom, rubber-band multi-select, drag-to-wire,
right-click search-insert).

```
node server.js 5601        # then open http://localhost:5601
```

No build step, no npm install. Pure HTML/CSS/vanilla JS.

---

## Concept — the module chain

An effect is assembled from a **chain of modules** that feeds an **Emitter**,
and one or more emitters feed the single **Effect Output** node:

```
Shape → Init… → Force… → OverLife… → Render  ─┐
                                              ├─►  Emitter ─►  Emitter ─►  Effect Output
                                  (modules)   ┘   (emitters chain)
```

* **Shape** — where particles spawn and the outward "normal" direction.
* **Init** — initial per-particle properties (speed, size, life, colour, rotation…).
* **Force** — accelerations applied every frame (gravity, drag, turbulence, …).
* **OverLife** — properties animated across each particle's lifetime (colour
  gradient, size/alpha/velocity curves).
* **Render** — how a particle is drawn (procedural sprite, blend mode, glow,
  velocity stretch, or an **emoji/text** glyph).
* **Emitter** — turns a module chain into a spawnable emitter (rate, burst,
  duration, loop, origin, max particles, prewarm).
* **Effect Output** — the sink: background colour, motion-blur *Trails*, time scale.

Ports are **type-checked**: module ports (orange) only connect to module ports,
emitter ports (cyan) only to emitter ports.

---

## Node catalogue

| Category  | Nodes |
|-----------|-------|
| **Shape** | Point · Circle · Ring (arc) · Cone · Box · Line |
| **Init**  | Speed · Velocity (XY) · Size · Lifetime · Color · Color (HSV) · Rotation/Spin |
| **Force** | Gravity · Drag · Turbulence (curl-noise) · Wind · Attractor · Vortex · Radial · Floor Bounce |
| **OverLife** | Color (gradient) · Alpha (curve) · Size (curve) · Velocity (curve) |
| **Render** | procedural sprite (soft/circle/square/triangle/star/ring/spark/plus) · emoji/text |
| **Emitter / Output** | Emitter · Effect Output |

### Custom parameter widgets
* **Gradient editor** — drag stops, double-click to add/remove, colour-pick each stop.
* **Curve editor** — draggable points on a mini canvas (click to add, right-click
  to remove) with from/to range.
* **Range** (`min–max`) for randomised initial values, plus sliders, colour
  pickers, dropdowns, toggles and text.

---

## Presets

Fire · Explosion · Smoke · Magic Sparkle · Fountain · Rain · Snow · Confetti ·
Portal · Rainbow Burst (HSV) · Bouncy Coins (emoji + bounce) · Fireworks.

Pick from the **Presets** dropdown; the graph loads and the view auto-fits.

---

## Exporting

Open the **Export** panel (top-right). A dashed cyan **capture frame** appears on
the preview showing exactly the region that will be exported — use the **Zoom**
slider and **Origin** to frame the effect.

* **Sprite Sheet PNG** — renders `Cols × Rows` frames sampled across *Duration*
  into a grid. Tick *Transparent bg* for game engines (Woditor object/effect
  animations). Capture is WYSIWYG with the on-screen frame at the live zoom.
* **WebM Clip** — records the live canvas in real time for *Duration* seconds.
* **Frame PNG** — the current single frame.

Graphs save/load as JSON (**Save** / **Open**), so effects are portable.

---

## Controls

| Action | How |
|--------|-----|
| Add node | click a palette item, or **right-click** the canvas to search-insert |
| Connect | drag from one port dot to another (drag off an input to detach) |
| Delete wire | click it |
| Move / multi-move | drag node header (drag a selection to move the group) |
| Select | left-drag rubber band · Shift/Ctrl to add · **Ctrl+A** all |
| Pan / Zoom | right/middle-drag · mouse wheel |
| Play / Pause | **Space** · Restart **R** · Fit **F** |
| Undo / Redo | **Ctrl+Z** / **Ctrl+Shift+Z** (or Ctrl+Y) |
| Copy / Paste | **Ctrl+C** / **Ctrl+V** (pastes at cursor) |
| Duplicate | **Ctrl+D** · Delete **Del** |
| Randomize | 🎲 button — jitters params of the selection (or whole graph) |
| Save graph | **Ctrl+S** |

---

## Files

| File | Role |
|------|------|
| `js/nodes.js`  | node registry: ports, params, `compile()` → plain-data modules |
| `js/graph.js`  | graph model + compilation to an `EffectSpec` |
| `js/engine.js` | `ParticleEngine` — spawning, physics, over-life, canvas rendering |
| `js/editor.js` | node-editor UI (pan/zoom/select/wire + param widgets) |
| `js/presets.js`| ready-made effect graphs + layout builder |
| `js/main.js`   | app wiring: transport, history, export, settings |
| `server.js`    | zero-dep static server + `/api/settings` persistence |

The `日本語` toggle switches node titles/hints to Japanese (persisted via
`settings.json`).
