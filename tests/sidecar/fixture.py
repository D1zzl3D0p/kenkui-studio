"""Exercise the real local API without downloading models or rendering audio."""

import os
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sidecar"))

from kenkui_sidecar import main


def app_factory(data_dir: Path) -> object:
    from kenkui_server.app import create_app

    # Both Python prints and inherited worker stdout must leave protocol intact.
    print("application output", flush=True)
    subprocess.run([sys.executable, "-c", "print('worker output')"], check=True)
    app = create_app(
        data_dir=data_dir,
        fixture_mode=True,
        voices=(),
        allowed_origins=[],
        stop_workers_on_close=True,
    )
    if os.environ.get("SIDECAR_FAIL_STARTUP"):

        @asynccontextmanager
        async def fail(app):
            raise RuntimeError("fixture startup failure")
            yield

        app.router.lifespan_context = fail
    return app


raise SystemExit(main(app_factory))
