"""Development entry point for the desktop's local API process.

Run with the Python environment containing kenkui-server. stdout is a versioned
JSON-lines control channel; stderr receives all application and worker output.
The parent owns stdin and closes it to request graceful API shutdown.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import sys
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from threading import Event, Thread
from typing import TextIO


def control_output() -> TextIO:
    """Keep protocol output separate even from native and child-process prints."""
    sys.stdout.flush()
    protocol = os.fdopen(
        os.dup(sys.stdout.fileno()), "w", buffering=1, encoding="utf-8"
    )
    os.set_inheritable(protocol.fileno(), False)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    return protocol


def watch_parent(stopped: Event) -> None:
    # Use a daemon and an unbuffered descriptor: console/pipe reads work on
    # Windows too, without leaving a buffered stdin lock held at interpreter exit.
    try:
        while os.read(0, 4096):
            pass
    except OSError:
        pass
    finally:
        stopped.set()


async def serve(app: object, protocol: TextIO, stopped: Event) -> bool:
    import uvicorn

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        # Keep the socket open through startup, avoiding a find-free-port race.
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        listener.setblocking(False)
        port = listener.getsockname()[1]
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                host="127.0.0.1",
                port=port,
                lifespan="on",
                access_log=False,
                timeout_graceful_shutdown=10,
            )
        )

        async def supervise() -> None:
            while not server.started and not stopped.is_set():
                await asyncio.sleep(0.02)
            if not stopped.is_set():
                try:
                    protocol.write(
                        json.dumps(
                            {
                                "type": "ready",
                                "protocolVersion": 1,
                                "baseUrl": f"http://127.0.0.1:{port}",
                                "pid": os.getpid(),
                            }
                        )
                        + "\n"
                    )
                    protocol.flush()
                except (BrokenPipeError, OSError):
                    stopped.set()
            while not stopped.is_set():
                await asyncio.sleep(0.05)
            server.should_exit = True

        monitor = asyncio.create_task(supervise())
        try:
            await server.serve(sockets=[listener])
            return server.started
        finally:
            monitor.cancel()
            await asyncio.gather(monitor, return_exceptions=True)


def local_app(
    data_dir: Path,
    *,
    max_jobs: int = 2,
    render_workers: int = 2,
    model: str | None = None,
) -> object:
    from kenkui_server.app import create_app
    from kenkui_server.config import DEFAULT_CHARACTER_MODEL
    from kenkui_server.observability import configure_logging

    models = ()
    if os.environ.get("OPENROUTER_API_KEY", "").strip():
        selected = model or DEFAULT_CHARACTER_MODEL
        if (
            not selected.startswith("openrouter/")
            or not selected.removeprefix("openrouter/").strip()
        ):
            raise ValueError("Local character model must use the openrouter/ provider")
        models = (selected,)

    configure_logging()
    return create_app(
        data_dir=data_dir,
        allowed_origins=[],
        max_jobs=max_jobs,
        render_workers=render_workers,
        model_allowlist=models,
        stop_workers_on_close=True,
    )


def provision_voices(stopped: Event, report: Callable[[str], None]) -> bool:
    """Materialize the same VCTK set as the cloud before exposing the API."""
    import kenkui as kk
    from kenkui_server.voice_catalog import VCTK_VOICE_SET, select_hosted_voices

    voices = select_hosted_voices(VCTK_VOICE_SET, kk.list_voices())
    for index, voice in enumerate(voices, 1):
        if stopped.is_set():
            return False
        report(f"Preparing voice {index} of {len(voices)}: {voice.id}")
        # Core verifies cached voice assets and reuses downloaded engine weights.
        kk.load_voice(voice.id)
    return not stopped.is_set()


def concurrency(value: str) -> int:
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(
            "Concurrency must be an integer from 1 to 8"
        ) from None
    if not 1 <= number <= 8:
        raise argparse.ArgumentTypeError("Concurrency must be an integer from 1 to 8")
    return number


def main(app_factory: Callable[[Path], object] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument(
        "--max-jobs",
        type=concurrency,
        default=os.environ.get("KENKUI_LOCAL_MAX_JOBS", "2"),
    )
    parser.add_argument(
        "--render-workers",
        type=concurrency,
        default=os.environ.get("KENKUI_LOCAL_RENDER_WORKERS", "2"),
    )
    parser.add_argument(
        "--openrouter-model",
        default=os.environ.get("KENKUI_LOCAL_OPENROUTER_MODEL"),
        help="Character model; credentials come from OPENROUTER_API_KEY",
    )
    parser.add_argument(
        "--provision-voices",
        action="store_true",
        help="Download/verify the cloud VCTK voice set before startup",
    )
    args = parser.parse_args()
    protocol = control_output()
    stopped = Event()
    Thread(target=watch_parent, args=(stopped,), daemon=True).start()
    try:
        data_dir = args.data_dir.expanduser().resolve()
        data_dir.mkdir(parents=True, exist_ok=True)
        # Workers inherit this too, so provisioning and rendering use one cache.
        os.environ["KENKUI_POCKET_MANIFEST"] = str(
            data_dir / "models" / "manifest.json"
        )
        if stopped.is_set():
            return 0

        def report(message: str) -> None:
            protocol.write(
                json.dumps(
                    {
                        "type": "progress",
                        "protocolVersion": 1,
                        "pid": os.getpid(),
                        "message": message,
                    }
                )
                + "\n"
            )
            protocol.flush()

        if args.provision_voices and not provision_voices(stopped, report):
            return 0
        app = (
            app_factory(data_dir)
            if app_factory
            else local_app(
                data_dir,
                max_jobs=args.max_jobs,
                render_workers=args.render_workers,
                model=args.openrouter_model,
            )
        )
        if stopped.is_set():
            return 0
        return 0 if asyncio.run(serve(app, protocol, stopped)) else 1
    finally:
        with suppress(OSError):
            protocol.close()


if __name__ == "__main__":
    raise SystemExit(main())
