"""Process-level sidecar checks, run with kenkui-server's Python environment."""

import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

FIXTURE = Path(__file__).with_name("fixture.py")


class SidecarProcessTests(unittest.TestCase):
    def start(self, *, fail=False, real=False, key=None):
        data = tempfile.TemporaryDirectory(prefix="kenkui-sidecar-test-")
        self.addCleanup(data.cleanup)
        errors = self.enterContext(tempfile.TemporaryFile(mode="w+"))
        env = dict(os.environ)
        for name in (
            "OPENROUTER_API_KEY",
            "KENKUI_LOCAL_MAX_JOBS",
            "KENKUI_LOCAL_RENDER_WORKERS",
            "KENKUI_LOCAL_OPENROUTER_MODEL",
        ):
            env.pop(name, None)
        if key:
            env["OPENROUTER_API_KEY"] = key
            env["KENKUI_LOCAL_OPENROUTER_MODEL"] = "openrouter/test/model"
        env.pop("SIDECAR_FAIL_STARTUP", None)
        if fail:
            env["SIDECAR_FAIL_STARTUP"] = "1"
        entrypoint = (
            FIXTURE.parents[1].parent / "sidecar" / "kenkui_sidecar.py"
            if real
            else FIXTURE
        )
        process = subprocess.Popen(
            [
                sys.executable,
                str(entrypoint),
                "--data-dir",
                str(Path(data.name) / "server"),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=errors,
            text=True,
            env=env,
        )

        def cleanup():
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
            process.stdin.close()
            process.stdout.close()

        self.addCleanup(cleanup)
        return process, errors

    def ready(self, process):
        lines = queue.Queue()
        threading.Thread(
            target=lambda: lines.put(process.stdout.readline()), daemon=True
        ).start()
        line = lines.get(timeout=30)
        self.assertTrue(line, "Sidecar exited without readiness")
        ready = json.loads(line)
        self.assertEqual(ready["type"], "ready")
        self.assertEqual(ready["protocolVersion"], 1)
        self.assertEqual(ready["pid"], process.pid)
        self.assertRegex(ready["baseUrl"], r"^http://127\.0\.0\.1:[1-9][0-9]*$")
        return ready["baseUrl"]

    def test_serves_real_api_then_exits_on_parent_eof(self):
        process, errors = self.start()
        base_url = self.ready(process)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(base_url + "/v1/capabilities", timeout=5) as response:
            capabilities = json.load(response)
        self.assertEqual(capabilities["apiVersion"], "1")
        self.assertEqual(capabilities["auth"]["mode"], "none")
        with opener.open(base_url + "/v1/health", timeout=5) as response:
            self.assertEqual(response.status, 200)
        process.stdin.close()
        self.assertEqual(process.wait(timeout=15), 0)
        self.assertEqual(process.stdout.read(), "")
        errors.seek(0)
        logs = errors.read()
        self.assertIn("application output", logs)
        self.assertIn("worker output", logs)
        self.assertIn("Application shutdown complete", logs)

    def test_failed_startup_never_announces_ready(self):
        process, errors = self.start(fail=True)
        self.assertNotEqual(process.wait(timeout=30), 0)
        self.assertEqual(process.stdout.read(), "")
        errors.seek(0)
        self.assertIn("fixture startup failure", errors.read())

    def test_development_entrypoint(self):
        process, _ = self.start(real=True)
        origin = self.ready(process)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(origin + "/v1/capabilities", timeout=5) as response:
            capabilities = json.load(response)
        self.assertNotIn("characters", capabilities["casting"]["modes"])
        self.assertEqual(capabilities["casting"]["models"], [])
        process.stdin.close()
        self.assertEqual(process.wait(timeout=15), 0)

    def test_openrouter_key_advertises_character_casting_without_network_call(self):
        process, errors = self.start(real=True, key="test-secret-not-a-real-key")
        origin = self.ready(process)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(origin + "/v1/capabilities", timeout=5) as response:
            capabilities = json.load(response)
        self.assertIn("characters", capabilities["casting"]["modes"])
        self.assertEqual(capabilities["casting"]["models"], ["openrouter/test/model"])
        self.assertNotIn("test-secret", json.dumps(capabilities))
        process.stdin.close()
        self.assertEqual(process.wait(timeout=15), 0)
        errors.seek(0)
        self.assertNotIn("test-secret", errors.read())

    def test_parent_exits_before_startup(self):
        process, _ = self.start()
        process.stdin.close()
        self.assertEqual(process.wait(timeout=30), 0)
        self.assertEqual(process.stdout.read(), "")

    def test_lost_protocol_reader_stops_api(self):
        process, _ = self.start()
        process.stdout.close()
        self.assertEqual(process.wait(timeout=30), 0)


if __name__ == "__main__":
    unittest.main()
