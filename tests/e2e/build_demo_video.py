"""Writes demo-frames/list.txt for ffmpeg: each frame shown for as long as it was on screen (see record_demo.js)."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

frames = json.load(open(HERE / "demo-frames/frames.json"))
with open(HERE / "demo-frames/list.txt", "w") as f:
    for a, b in zip(frames, frames[1:] + [None]):
        d = min((b["t"] - a["t"]) if b else 1.0, 2.0)
        f.write(f"file '{a['file'].replace(chr(92), '/')}'\nduration {d:.4f}\n")
    f.write(f"file '{frames[-1]['file'].replace(chr(92), '/')}'\n")
