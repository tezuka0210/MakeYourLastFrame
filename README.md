# Make Your Last Frame  (Local Demo)

This project is a visual analytics system designed to bridge the gap between abstract creative thoughts and controllable video generation. By shifting from traditional "text-to-video" box-ticking to an Asset-Oriented and Non-linear Branching workflow, this project empowers creators to maintain precise control over composition, character consistency, and narrative evolution.

---
🌟 Core Features
1. Asset-Oriented Re-authoring
Break free from ambiguous text prompts. This project allows you to:
- Extract & Reuse: Isolate specific characters, props, or backgrounds from generated images.
- Canvas Interaction: Precisely control the position, scale, and layering of assets through an intuitive drag-and-drop interface.
- Hybrid Sketching: Combine visual assets with hand-drawn sketches to define the exact layout of the next keyframe.
2. Non-linear Branching View
Inspired by version control systems, MakeYourLastFrame manages the creative process through a Creative Tree:
- Traceable History: Every iteration is recorded as a node, ensuring no creative spark is lost.
- Parallel Exploration: Easily branch out to explore different visual directions (e.g., different lighting or character actions) from any point in the history.
3. Multi-Agent Assistance
A matrix of LLM-driven "Expert Agents" streamlines the complex T2V workflow.


---
📦 Getting Started
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