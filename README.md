# Make Your Last Frame  (Local Demo)

MakeYourLastFrame is an iterative video authoring system designed to bridge the gap between abstract user intent and precise generative control. By treating generated images as a collection of re-authorable Visual Assets, the system allows users to intervene in the generative process to resolve spatial, structural, and temporal inconsistencies.

## 🏗️ System Architecture

MYLF adopts a decoupled architecture to ensure flexibility and modularity:
- MakeYourLastFrame (Frontend & Logic): The primary application that manages the Visual Asset Re-Authoring lifecycle, including Intent Drafting, Entity Grounding, and the Phase-based Workflow.
- ComfyUI Backend (Independent): A standalone, high-performance generative backend. The system communicates with ComfyUI via API to execute complex diffusion pipelines without bloating the main application logic.
- Backend Intelligence (SAM3): Integrated within MakeYourFinalFrame/backend, the Segment Anything Model 3 (SAM3) serves as the core engine for Entity Grounding, enabling precise pixel-level mask generation for specific scene entities.

## 📦 Technical Model Stack
The system orchestrates a suite of state-of-the-art models to ensure high-fidelity outcomes:
```
flux-2-klein-base-9b-fp8.safetensors
flux1-fill-dev.safetensors
z_image_turbo_bf16.safetensors
Wan2_1-T2V-14B_fp8_e4m3fn.safetensors

wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors
wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors
wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors
wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors
wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors
wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors
wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors
wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors
```

## 📂 Project Structure
To ensure the system functions correctly, please organize your directories as follows:
```
├── MakeYourFinalFrame/          # Main Application Root
│   ├── backend/                 # Backend-specific logic
│       └── sam3/                # SAM3 model weights and inference 
│       └──workflows/            # ComfyUI API JSON files (MUST be placed here)
│   └── frontend/                # UI and State Management
├── ComfyUI/                     # Standalone ComfyUI Root
│   ├── models/
│   │   └── diffusion_models/    # Place Flux2 and Wan2.2 weights here
│   └── ...
└── ...
```
## 🌟 Key Features

MakeYourLastFrame turns the linear text-to-video process into a controllable, iterative authoring experience. The core loop is:

> **generate → decompose into named parts → rearrange on a shared scene → cut viewports → generate again**

### Automatic entity decomposition

After each generation, a vision model inspects the result together with the prompt it came from and proposes which parts of the scene are worth keeping as separate assets. SAM3 then cuts them out and stores each one as a named PNG in `backend/entities/`.

Decomposition follows explicit priority rules: living, moving subjects first; prominent independent structures second; vegetation excluded unless it is the subject. Attached items are never split from their subject — a person in a dress is one entity, `person`, not two.

Each entity is registered with a name, a thumbnail, and an appearance record listing every node it shows up in, so an asset can be traced across the whole authoring tree.

### Re-authoring canvas

A single scene canvas, larger than any one frame, is where assets are recomposed:

- Drop in generated results, uploaded images, segmented entities, and buffered assets
- Move, resize, flip, and reorder in depth; z-order is fully controllable from the right-click menu
- Draw by hand directly on the canvas (live iPad + Procreate input is supported)
- Paint masks and select regions
- Export the arrangement as a composite, a source image, or a mask

**Pixel-accurate hit testing.** Segmented PNGs and hand-drawn strokes carry large transparent margins. Pressing inside a transparent area does *not* grab the asset — the click falls through to the canvas, so marquee selection and panning keep working over visually empty space.

### Keyframe viewports

Keyframes are not composed one at a time. You build one over-complete scene and then cut multiple viewports out of it. Overlapping viewports share content by construction, which is what makes consecutive keyframes read as the same place.

- **Aspect-ratio snapping.** While dragging a viewport, the nearest common aspect ratio is detected and snapped to within a 5% tolerance, with a ratio badge and alignment guides. Hold <kbd>Alt</kbd> to draw freely.
  Supported: `9:16` · `2:3` · `3:4` · `1:1` · `5:4` · `4:3` · `3:2` · `16:9` · `1.85:1` · `2:1` · `21:9` · `2.39:1`
- **Right-click a viewport's grip bar** for: duplicate right or down at 50% / 30% / no overlap; push in; pull out; match size to the first viewport; delete. All duplication and scaling preserve the source aspect ratio.
- Viewports with mismatched aspect ratios are flagged in the console, since frames of differing ratios cannot be cut together.
- Scene-space viewport size is free and meaningful: a larger box is a wider shot, a smaller box a tighter one.

### Asset groups

Assets can be packaged into a named group that behaves as one unit while preserving the spatial relationships inside it — for example a segmented character plus a hand-drawn element that must stay in a fixed relation to it.

- Drag a marquee on empty canvas to select two or more assets; name the group when prompted
- Dragging any member moves the whole group; scrolling over any member scales the group about its bounding-box centre
- **The group is the unit of selection.** Pressing any member highlights the group's outline, not the individual asset, so it is always clear that the whole package is about to move
- Double-click the group label to rename; right-click it to rename, scale, ungroup, or delete the group with its assets
- Moving a keyframe viewport does **not** disturb grouped assets, since a group represents a deliberate arrangement

The group outline and its members share one rendering path — both are positioned by GPU-composited transforms, and during a drag the outline is translated by the same delta rather than re-measured each frame. Without this the outline lags behind its contents and smears.

### Composition records

Every viewport export is recorded alongside the flattened PNG: the viewport rectangle in scene coordinates, and for each asset its identity, depth order, scene rectangle, position normalised to the viewport, visibility, and coverage. Records from one canvas state share a `scene_session_id`.

This makes the shared content between any two keyframes directly queryable — which assets they have in common, and how much their viewports geometrically overlap.

### Multi-agent intent alignment

A Master / Workflow / Prompt agent chain turns rough intent into model-specific prompts, decomposing input into editable positive and negative cues and folding in descriptions of the assets currently in play.

### Anchor-based temporal synthesis

Re-authored keyframes act as stable anchors for Wan2.2 video generation, including first/last-frame conditioning, camera control, and frame interpolation. Selected clips are assembled on a multi-track buffer timeline (image / video / audio) and exported as a single video.

### Node-based authoring trace

Every step is a node in a tree with full provenance. Branches capture alternatives, merge nodes recombine them, and any earlier state can be revisited. Generative backends are swapped by changing ComfyUI workflow JSON without touching the authoring logic.

## 🖱️ Interaction Model

| Where you press | Left drag | <kbd>Space</kbd> + left, or middle | Right click |
|---|---|---|---|
| Opaque part of an asset | Move the asset — or the whole group, with the group outline highlighted | Pan the canvas | Asset menu |
| Transparent part of an asset | Marquee-select | Pan the canvas | — |
| Empty canvas | Marquee-select | Pan the canvas | — |
| Viewport grip bar | Move the viewport | Pan the canvas | Viewport menu |
| Group label | — | — | Group menu (double-click to rename) |

Scroll wheel zooms the canvas; scrolling over an asset scales that asset, or its group. Right-click is reserved for context menus and never pans.

## 🔌 Composition Records API

Additive endpoints, independent of the main authoring flow:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/composition/record` | Store the composition behind one viewport export |
| `GET` | `/api/composition/records?scene_session_id=…&tree_id=…` | Retrieve stored records |
| `GET` | `/api/composition/intersections?scene_session_id=…` | For every pair of viewports in a scene, report the assets they share and their geometric overlap (area and IoU) |

Records live in the `CompositionRecords` table, created on demand at startup. Existing databases are upgraded in place without touching other tables.

## 📦 Getting Started
Prerequisites
- Python 3.10.14 (the project-level `.python-version` lets pyenv select it automatically)
- Node.js 18+
- NVIDIA GPU 
Installation
1. Clone the Repository
```
git clone https://github.com/tezuka0210/MakeYourLastFrame.git
cd MakeYourLastFrame
```
2. Backend Setup
```
cd backend
python -m pip install -r requirements.txt
python app.py
```
3. Frontend Setup
```
cd frontend
npm install
npm run dev
```

## Speech-to-text configuration

The microphone control records audio in the browser and sends it to the backend;
the backend uses DMXAPI's Qwen Omni audio-input endpoint by default, while
retaining `gpt-4o-transcribe` as a configurable compatibility path. Copy
`backend/.env.example` to `backend/.env` and set `SPEECH_TRANSCRIBE_API_KEY` to a
DMXAPI Key before starting the backend. The key remains server-side and is never
sent to the browser. Browser-recorded WebM is automatically converted to WAV
before upload, so FFmpeg must be available on the backend host. Domain hotwords,
aliases and post-recognition corrections are configured in
`backend/speech_glossary.json`; see `backend/speech_glossary.example.json` and
`docs/语音输入转文本功能说明.md` for the model-switching and glossary details.
