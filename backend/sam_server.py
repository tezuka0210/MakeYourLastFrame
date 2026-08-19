import os
import tempfile

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

from agents.sam_agent import SAMAgent


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENTITY_OUTPUT_DIR = os.getenv("SAM_ENTITY_OUTPUT_DIR", os.path.join(BASE_DIR, "entities"))
PUBLIC_BASE_URL = os.getenv("SAM_PUBLIC_BASE_URL", "").strip().rstrip("/")

app = Flask(__name__)
CORS(app)
sam_service = SAMAgent()


def public_entity_url(filename: str) -> str:
    path = f"/entities/{filename}"
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL}{path}"
    return path


@app.route("/api/sam/segment", methods=["POST"])
def segment():
    image = request.files.get("image")
    prompt = (request.form.get("prompt") or "").strip()
    output_dir = request.form.get("output_dir") or ENTITY_OUTPUT_DIR

    if not image:
        return jsonify({"error": "Missing image"}), 400
    if not prompt:
        return jsonify({"error": "Missing prompt"}), 400

    os.makedirs(output_dir, exist_ok=True)
    suffix = os.path.splitext(secure_filename(image.filename or "image.png"))[1] or ".png"
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_image:
            image.save(temp_image)
            temp_path = temp_image.name

        segments = sam_service.segment_by_text(
            image_path=temp_path,
            text_prompt=prompt,
            output_dir=output_dir
        )

        normalized_segments = []
        for item in segments:
            filename = os.path.basename(item.get("path", ""))
            normalized = dict(item)
            normalized["filename"] = filename
            normalized["path"] = public_entity_url(filename)
            normalized_segments.append(normalized)

        return jsonify({"segments": normalized_segments}), 200
    except Exception as exc:
        print(f"SAM segmentation failed: {exc}")
        return jsonify({"error": str(exc)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.route("/entities/<path:filename>")
def serve_entity(filename):
    return send_from_directory(ENTITY_OUTPUT_DIR, filename, as_attachment=False)


if __name__ == "__main__":
    port = int(os.getenv("SAM_SERVER_PORT", "5010"))
    app.run(host="0.0.0.0", port=port, debug=False)
