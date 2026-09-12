"""The E2E harness must locate kenkui-server without assuming directory position."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parent / "local-server.py"


def test_honors_kenkui_server_root(tmp_path):
    """An explicit KENKUI_SERVER_ROOT overrides the sibling-directory default.

    The probe must exit before the harness imports the server or binds a port,
    so a timeout here is a failure: it means the early exit never happened.
    """
    env = {**os.environ, "KENKUI_SERVER_ROOT": str(tmp_path), "KENKUI_PRINT_SERVER_ROOT": "1"}
    try:
        result = subprocess.run(
            [sys.executable, str(HARNESS)], env=env, capture_output=True, text=True, timeout=30
        )
    except subprocess.TimeoutExpired:
        pytest.fail("the harness ignored KENKUI_PRINT_SERVER_ROOT and started the server")

    assert result.stdout.strip() == str(tmp_path)
