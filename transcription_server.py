import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from faster_whisper import WhisperModel


HOST = "127.0.0.1"
PORT = 18765
MAX_UPLOAD_BYTES = 500 * 1024 * 1024

_model = None
_model_lock = threading.Lock()


def get_model():
    global _model
    with _model_lock:
        if _model is None:
            _model = WhisperModel("small", device="cpu", compute_type="int8")
        return _model


def srt_time(seconds):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1_000)
    return f"{hours:02}:{minutes:02}:{secs:02},{milliseconds:03}"


def transcribe(path):
    segments_iter, info = get_model().transcribe(
        str(path),
        beam_size=5,
        vad_filter=True,
    )
    segments = [
        {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        }
        for segment in segments_iter
        if segment.text.strip()
    ]

    text = "\n".join(segment["text"] for segment in segments)
    srt = "\n".join(
        (
            f"{index}\n"
            f"{srt_time(segment['start'])} --> {srt_time(segment['end'])}\n"
            f"{segment['text']}\n"
        )
        for index, segment in enumerate(segments, start=1)
    )
    return {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration_seconds": info.duration,
        "text": text,
        "srt": srt,
        "segments": segments,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "XHSTranscription/0.1"

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}", flush=True)

    def allowed_origin(self):
        origin = self.headers.get("Origin", "")
        return origin.startswith("chrome-extension://")

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if self.allowed_origin():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.allowed_origin():
            self.send_json(403, {"error": "Only Chrome extensions are allowed"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path != "/health":
            self.send_json(404, {"error": "Not found"})
            return
        self.send_json(200, {"ok": True, "model": "small"})

    def do_POST(self):
        if urlparse(self.path).path != "/transcribe":
            self.send_json(404, {"error": "Not found"})
            return
        if not self.allowed_origin():
            self.send_json(403, {"error": "Only Chrome extensions are allowed"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_UPLOAD_BYTES:
            self.send_json(413, {"error": "Invalid or oversized upload"})
            return

        query = parse_qs(urlparse(self.path).query)
        requested_name = query.get("filename", ["video.mp4"])[0]
        suffix = Path(requested_name).suffix or ".mp4"

        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_path = Path(temp_file.name)
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Upload ended early")
                    temp_file.write(chunk)
                    remaining -= len(chunk)

            result = transcribe(temp_path)
            self.send_json(200, result)
        except Exception as error:
            self.send_json(500, {"error": str(error)})
        finally:
            if temp_path:
                temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    print(f"XHS transcription service listening on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
