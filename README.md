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
## 🌟 Key Features & Paper Terminology
MakeYourLastFrame provides a suite of interactive tools designed to transform the linear text-to-video process into a controllable, iterative authoring experience:
- SAM3-Powered Entity Grounding & Re-Authoring: The system enables users to decompose a scene into manipulatable Visual Assets. By integrating SAM3 (Segment Anything Model 3), users can precisely segment entities and perform local Re-Authoring—editing specific attributes or fixing Generation Errors (e.g., anatomical distortions) without altering the rest of the image.
- Interactive Spatial Intervention: To resolve Position Deviations, MakeYourLastFrame provides a 2D canvas for manual spatial adjustment. Users can reposition or resize "grounded" assets, which are then treated as Hard Constraints (Masks) to guide the Flux2 diffusion backbone, ensuring the final composition perfectly matches the desired layout.
- Multi-Agent Intent Alignment: The Intent Drafting interface utilizes a multi-agent framework (Master, Workflow, and Prompt Agents) to bridge the gap between abstract ideas and model-specific prompts. This ensures high-fidelity Intent Alignment, effectively eliminating Requirement Mismatches by refining user input before execution.
- Anchor-Based Temporal Synthesis: By treating re-authored keyframes as stable Visual Anchors, the system leverages Wan2.2 for Video Assembly. This ensures Temporal Continuity and mitigates Cross-phase Inconsistencies, allowing for smooth transitions and identity preservation across the generated video sequence.
- Decoupled Workflow Management: Users can manage complex creation paths through a Node-based Visual Trace (T2VTree). The system maintains an independent connection to the ComfyUI API, allowing for the rapid swapping of Flux2 and Wan2.2 workflows while keeping the authoring logic separate from the generative computation.

## 📦 Getting Started
Prerequisites
- Python 3.10+
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
pip install -r requirements.txt
python main.py
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
