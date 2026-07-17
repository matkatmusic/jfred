"""Smoke checks for scripts/run_scenario_dispatcher.py: the silent-passthrough
contract (unmatched prompts and unknown subcommands exit 0 with empty stdout)
and the env bootstrap. Launch-path behavior needs a live tmux/Claude and is
exercised by run-all-scenarios.py, not here."""
import json
import subprocess
import sys
from pathlib import Path

DISPATCHER = str(Path(__file__).resolve().parent.parent / "scripts" / "run_scenario_dispatcher.py")


def runDispatcher(argv, stdin_text):
    return subprocess.run(
        [sys.executable, DISPATCHER, *argv],
        input=stdin_text, capture_output=True, text=True, timeout=30,
    )


def test_unmatched_prompt_passes_through_silently():
    payload = json.dumps({"prompt": "hello, unrelated prompt"})
    result = runDispatcher([], payload)
    assert result.returncode == 0
    assert result.stdout == ""


def test_empty_stdin_passes_through_silently():
    result = runDispatcher([], "")
    assert result.returncode == 0
    assert result.stdout == ""


def test_unknown_subcommand_exits_zero():
    result = runDispatcher(["not-a-subcommand"], "")
    assert result.returncode == 0
    assert result.stdout == ""


def test_session_start_subcommand_writes_ready_signal(tmp_path):
    signal_dir = tmp_path / "signals"
    result = runDispatcher(["run-scenario-session-start", str(signal_dir)], "")
    assert result.returncode == 0
    assert (signal_dir / "ready").is_file()
