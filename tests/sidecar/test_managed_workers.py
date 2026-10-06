"""Real process-tree shutdown tests; only Python's standard library is needed."""

import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUARDIAN = ROOT.parent / "kenkui-server/src/kenkui_server/compute/managed_worker.py"
TREE = Path(__file__).with_name("worker_tree.py")


class ManagedWorkerTests(unittest.TestCase):
    def start(self, *, api_parent=False):
        directory = self.enterContext(
            tempfile.TemporaryDirectory(prefix="kenkui-workers-")
        )
        root = Path(directory)
        command = [sys.executable, str(GUARDIAN), sys.executable, str(TREE), str(root)]
        if api_parent:
            command = [
                sys.executable,
                "-c",
                (
                    "import subprocess,sys,time; "
                    "child = subprocess.Popen(sys.argv[1:], stdin=subprocess.PIPE); "
                    "time.sleep(120)"
                ),
                *command,
            ]
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL
        )

        def cleanup():
            if process.stdin:
                process.stdin.close()
            if api_parent and process.poll() is None:
                process.kill()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

        self.addCleanup(cleanup)
        ports = []
        for name in ("worker", "encoder"):
            deadline = time.monotonic() + 15
            while True:
                try:
                    ports.append(
                        json.loads((root / f"{name}.json").read_text())["port"]
                    )
                    break
                except (FileNotFoundError, json.JSONDecodeError):
                    if time.monotonic() >= deadline:
                        self.fail(f"{name} never started")
                    time.sleep(0.02)
        return process, ports

    def assert_stopped(self, ports):
        deadline = time.monotonic() + 10
        while True:
            alive = False
            for port in ports:
                with socket.socket() as probe:
                    probe.settimeout(0.2)
                    alive |= probe.connect_ex(("127.0.0.1", port)) == 0
            if not alive:
                return
            self.assertLess(
                time.monotonic(), deadline, "A conversion process survived API shutdown"
            )
            time.sleep(0.02)

    def test_closing_control_pipe_stops_stubborn_worker_and_encoder(self):
        process, ports = self.start()
        process.stdin.close()
        self.assertEqual(process.wait(timeout=10), 0)
        self.assert_stopped(ports)

    def test_killing_api_parent_also_stops_worker_and_encoder(self):
        process, ports = self.start(api_parent=True)
        process.kill()
        process.wait(timeout=5)
        self.assert_stopped(ports)


if __name__ == "__main__":
    unittest.main()
