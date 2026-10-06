"""Offline coverage of desktop provisioning and capability configuration."""

import argparse
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).parents[2] / "sidecar"))
import kenkui_sidecar as sidecar


class ConfigurationTests(unittest.TestCase):
    def test_default_concurrency_and_no_key_disable_character_casting(self):
        create = Mock()
        modules = {
            "kenkui_server.app": SimpleNamespace(create_app=create),
            "kenkui_server.config": SimpleNamespace(
                DEFAULT_CHARACTER_MODEL="openrouter/cloud/default"
            ),
            "kenkui_server.observability": SimpleNamespace(configure_logging=Mock()),
        }
        with (
            patch.dict(sys.modules, modules),
            patch.dict(os.environ, {"OPENROUTER_API_KEY": "  "}),
        ):
            sidecar.local_app(Path("data"))
        self.assertEqual(create.call_args.kwargs["max_jobs"], 2)
        self.assertEqual(create.call_args.kwargs["render_workers"], 2)
        self.assertEqual(create.call_args.kwargs["model_allowlist"], ())
        self.assertTrue(create.call_args.kwargs["stop_workers_on_close"])

    def test_key_enables_default_or_custom_model_without_passing_key_to_api(self):
        create = Mock()
        modules = {
            "kenkui_server.app": SimpleNamespace(create_app=create),
            "kenkui_server.config": SimpleNamespace(
                DEFAULT_CHARACTER_MODEL="openrouter/cloud/default"
            ),
            "kenkui_server.observability": SimpleNamespace(configure_logging=Mock()),
        }
        with (
            patch.dict(sys.modules, modules),
            patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-secret"}),
        ):
            for model, expected in [
                (None, "openrouter/cloud/default"),
                ("openrouter/custom/model", "openrouter/custom/model"),
            ]:
                sidecar.local_app(
                    Path("data"), max_jobs=3, render_workers=4, model=model
                )
                self.assertEqual(
                    create.call_args.kwargs["model_allowlist"], (expected,)
                )
                self.assertEqual(create.call_args.kwargs["max_jobs"], 3)
                self.assertEqual(create.call_args.kwargs["render_workers"], 4)
                self.assertNotIn("test-secret", repr(create.call_args))
            with self.assertRaisesRegex(ValueError, "openrouter/"):
                sidecar.local_app(Path("data"), model="other/provider")

    def test_provisioning_uses_cloud_selector_and_reports_every_voice(self):
        voices = [SimpleNamespace(id="a"), SimpleNamespace(id="b")]
        core = SimpleNamespace(list_voices=Mock(return_value=voices), load_voice=Mock())
        select = Mock(return_value=voices)
        report = Mock()
        modules = {
            "kenkui": core,
            "kenkui_server.voice_catalog": SimpleNamespace(
                VCTK_VOICE_SET="vctk", select_hosted_voices=select
            ),
        }
        with patch.dict(sys.modules, modules):
            self.assertTrue(sidecar.provision_voices(Event(), report))
        select.assert_called_once_with("vctk", voices)
        self.assertEqual(
            [call.args[0] for call in core.load_voice.call_args_list], ["a", "b"]
        )
        self.assertEqual(report.call_args.args, ("Preparing voice 2 of 2: b",))

    def test_parent_loss_stops_before_next_download(self):
        stopped = Event()
        core = SimpleNamespace(
            list_voices=Mock(), load_voice=Mock(side_effect=lambda _: stopped.set())
        )
        modules = {
            "kenkui": core,
            "kenkui_server.voice_catalog": SimpleNamespace(
                VCTK_VOICE_SET="vctk",
                select_hosted_voices=lambda *_: [
                    SimpleNamespace(id="a"),
                    SimpleNamespace(id="b"),
                ],
            ),
        }
        with patch.dict(sys.modules, modules):
            self.assertFalse(sidecar.provision_voices(stopped, Mock()))
        core.load_voice.assert_called_once_with("a")

    def test_download_failure_prevents_app_start_and_uses_private_manifest(self):
        with tempfile.TemporaryDirectory() as root:
            factory = Mock()
            with (
                patch.dict(os.environ),
                patch.object(
                    sys, "argv", ["sidecar", "--data-dir", root, "--provision-voices"]
                ),
                patch.object(sidecar, "control_output", return_value=io.StringIO()),
                patch.object(sidecar, "Thread"),
                patch.object(
                    sidecar,
                    "provision_voices",
                    side_effect=RuntimeError("download failed"),
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "download failed"):
                    sidecar.main(factory)
                self.assertEqual(
                    os.environ["KENKUI_POCKET_MANIFEST"],
                    str(Path(root).resolve() / "models" / "manifest.json"),
                )
            factory.assert_not_called()

    def test_concurrency_is_bounded(self):
        for invalid in ("0", "-1", "9", "2.5", "many"):
            with self.assertRaises(argparse.ArgumentTypeError):
                sidecar.concurrency(invalid)
        self.assertEqual(sidecar.concurrency("8"), 8)

    def test_launcher_environment_and_cli_overrides_reach_app(self):
        with (
            tempfile.TemporaryDirectory() as root,
            patch.dict(
                os.environ,
                {
                    "KENKUI_LOCAL_MAX_JOBS": "3",
                    "KENKUI_LOCAL_RENDER_WORKERS": "4",
                    "KENKUI_LOCAL_OPENROUTER_MODEL": "openrouter/example/model",
                },
            ),
            patch.object(
                sys, "argv", ["sidecar", "--data-dir", root, "--max-jobs", "5"]
            ),
            patch.object(sidecar, "control_output", return_value=io.StringIO()),
            patch.object(sidecar, "Thread"),
            patch.object(sidecar, "local_app") as app,
            patch.object(sidecar, "serve", new=AsyncMock(return_value=True)),
        ):
            self.assertEqual(sidecar.main(), 0)
            app.assert_called_once_with(
                Path(root).resolve(),
                max_jobs=5,
                render_workers=4,
                model="openrouter/example/model",
            )


if __name__ == "__main__":
    unittest.main()
