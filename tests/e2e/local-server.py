"""Run the sibling local server with its deterministic E2E fixture mode."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

WEB_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = WEB_ROOT.parent
SERVER_ROOT = REPOSITORY_ROOT / "kenkui-server"
sys.path.insert(0, str(SERVER_ROOT / "src"))

import kenkui as kk
import uvicorn
from kenkui_server.app import create_app


def main() -> None:
    with TemporaryDirectory(prefix="kenkui-web-e2e-") as data_dir:
        app = create_app(
            data_dir=data_dir,
            fixture_mode=True,
            voices=(kk.Voice("fixture-narrator", "Fixture Narrator", True, "local", "fixture", True),),
            web_build_path=WEB_ROOT / "dist",
        )
        uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("KENKUI_E2E_PORT", "4173")))


if __name__ == "__main__":
    main()
