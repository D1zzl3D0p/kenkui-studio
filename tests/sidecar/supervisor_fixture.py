"""Dependency-free child process for Rust lifecycle tests."""

import json
import os
import sys
import threading
from pathlib import Path

root = Path(sys.argv[-1])
mode = root.name
(root / "pid").write_text(str(os.getpid()))
if mode == "progress":
    print(
        json.dumps(
            {
                "type": "progress",
                "protocolVersion": 1,
                "pid": os.getpid(),
                "message": "Preparing voice 1 of 1",
            }
        ),
        flush=True,
    )
if mode == "invalid":
    print('{"type":"invalid"}', flush=True)
elif mode == "oversized":
    print("x" * 5000, flush=True)
elif mode != "timeout":
    print(
        json.dumps(
            {
                "type": "ready",
                "protocolVersion": 1,
                "baseUrl": "http://127.0.0.1:54321",
                "pid": os.getpid(),
            }
        ),
        flush=True,
    )

stopped = threading.Event()


def watch():
    while os.read(0, 4096):
        pass
    if mode != "stubborn":
        stopped.set()


threading.Thread(target=watch, daemon=True).start()
while not stopped.wait(0.01):
    if (root / "crash").exists():
        sys.exit(7)
(root / "stopped").write_text("stdin closed")
