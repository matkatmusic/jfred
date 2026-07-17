"""Tests for run-all-scenarios.py pure helpers (no tmux side effects)."""

import importlib.util
import sys
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parent.parent / "run-all-scenarios.py"


def loadModule():
    """Import the hyphenated run-all-scenarios.py as a module object."""
    # repo root on sys.path so the module's own imports (scenario_capture_lib,
    # tmux_lib) resolve regardless of pytest's cwd
    sys.path.insert(0, str(MODULE_PATH.parent))
    spec = importlib.util.spec_from_file_location("run_all_scenarios", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = loadModule()


def test_resolveOnlyScenario_by_bare_stem():
    """A bare stem resolves to the matching .txt in the scenarios dir."""
    result = mod.resolveOnlyScenario("s24-script-rename-functions")
    assert result is not None
    assert result.name == "s24-script-rename-functions.txt"
    assert result.is_file()


def test_resolveOnlyScenario_by_filename():
    """A filename (with .txt) resolves the same as a bare stem."""
    result = mod.resolveOnlyScenario("s24-script-rename-functions.txt")
    assert result is not None
    assert result.name == "s24-script-rename-functions.txt"


def test_resolveOnlyScenario_by_absolute_path():
    """An existing absolute path is returned resolved."""
    abs_path = mod.SCENARIOS_DIR / "s24-script-rename-functions.txt"
    result = mod.resolveOnlyScenario(str(abs_path))
    assert result == abs_path.resolve()


def test_resolveOnlyScenario_unknown_returns_none():
    """An unmatched value yields None (so selectScenarioFiles can error out)."""
    assert mod.resolveOnlyScenario("does-not-exist-xyz") is None


def test_selectScenarioFiles_only_returns_single():
    """--only narrows the run to exactly one scenario file."""
    files = mod.selectScenarioFiles("s24-script-rename-functions")
    assert len(files) == 1
    assert files[0].name == "s24-script-rename-functions.txt"


def test_selectScenarioFiles_none_returns_all():
    """No --only returns every scenario file in the directory."""
    files = mod.selectScenarioFiles(None)
    assert len(files) == len(mod.findScenarioFiles())
    assert len(files) > 1


def test_selectScenarioFiles_unknown_exits():
    """An unmatched --only value exits non-zero rather than running nothing."""
    with pytest.raises(SystemExit):
        mod.selectScenarioFiles("does-not-exist-xyz")


def test_parseStepProgress_reports_first_unchecked_step():
    """The first unchecked checkbox is the in-flight step; total counts all steps."""
    text = "tmpdir: /tmp/x\n- [x] 1. Say: `hello`\n- [ ] 2. Edit: foo.py\n- [ ] 3. Say: `bye`\n"
    assert mod.parseStepProgress(text) == (2, "Edit: foo.py", 3)
    assert mod.parseStepProgress("- [x] 1. Say: `done`\n") is None
    assert mod.parseStepProgress("no checkboxes here") is None


def test_reportStepProgress_prints_once_and_signals_advance(tmp_path, monkeypatch, capsys):
    """Each step advance prints once and returns True; repeats return False."""
    progress = tmp_path / "s9-run-20260717-120000.txt"
    progress.write_text("- [ ] 1. Say: `hello world`\n- [ ] 2. Say: `bye`\n")
    monkeypatch.setattr(mod, "findLatestExecutedFile", lambda stem: progress)
    last = {}

    assert mod.reportStepProgress("s9", last) is True
    assert "sending step 1/2: Say: `hello world`" in capsys.readouterr().out
    assert mod.reportStepProgress("s9", last) is False

    progress.write_text("- [x] 1. Say: `hello world`\n- [ ] 2. Say: `bye`\n")
    assert mod.reportStepProgress("s9", last) is True
    assert "sending step 2/2" in capsys.readouterr().out


def test_bumpDeadlinesOnProgress_resets_only_advancing_deadlines(monkeypatch):
    """A scenario that advanced gets a fresh deadline; a stalled one keeps its old deadline."""
    monkeypatch.setattr(mod, "reportStepProgress", lambda stem, last: stem == "alive")
    running = {"alive": 1.0, "stalled": 1.0}

    mod.bumpDeadlinesOnProgress(running, {})

    assert running["alive"] > 1.0
    assert running["stalled"] == 1.0


def test_hasCapturedRun_true_when_step_states_present(tmp_path, monkeypatch):
    """A scenario counts as run once executed/<stem>/.step_states/ exists."""
    monkeypatch.setattr(mod, "EXECUTED_DIR", tmp_path)
    (tmp_path / "s99-demo" / ".step_states" / "step-001").mkdir(parents=True)
    assert mod.hasCapturedRun("s99-demo") is True


def test_hasCapturedRun_false_without_step_states(tmp_path, monkeypatch):
    """No dir, or a captured dir lacking .step_states, is not a captured run."""
    monkeypatch.setattr(mod, "EXECUTED_DIR", tmp_path)
    assert mod.hasCapturedRun("missing") is False
    d = tmp_path / "s98-demo"
    d.mkdir()
    (d / "session.jsonl").write_text("{}")   # jsonl alone no longer counts
    assert mod.hasCapturedRun("s98-demo") is False


def test_selectScenarioFiles_skip_existing_drops_captured(tmp_path, monkeypatch):
    """--skip-existing keeps only scenarios that have no captured run yet."""
    monkeypatch.setattr(mod, "SCENARIOS_DIR", tmp_path)
    monkeypatch.setattr(mod, "EXECUTED_DIR", tmp_path / "executed")
    (tmp_path / "a-one.txt").write_text("session: a-one\n")
    (tmp_path / "b-two.txt").write_text("session: b-two\n")
    (tmp_path / "executed" / "a-one" / ".step_states" / "step-001").mkdir(parents=True)
    files = mod.selectScenarioFiles(None, skip_existing=True)
    assert sorted(f.name for f in files) == ["b-two.txt"]


def test_runScenariosWithLimit_caps_concurrency(monkeypatch):
    """No more than max_concurrent sessions are ever in flight at once."""
    live = set()
    peak = {"value": 0}

    def fake_launch(pane_target, scenario_file, index, total, model=""):
        stem = scenario_file.stem
        live.add(stem)
        peak["value"] = max(peak["value"], len(live))
        return stem

    def fake_record(stem, completed, failed):
        # Each polled session finishes immediately, freeing its slot.
        if stem in live:
            live.discard(stem)
            completed.append(stem)
            return True
        return False

    monkeypatch.setattr(mod, "launchScenario", fake_launch)
    monkeypatch.setattr(mod, "recordScenarioOutcome", fake_record)
    monkeypatch.setattr(mod.time, "sleep", lambda *_a, **_k: None)

    files = [Path(f"s{i}.txt") for i in range(20)]
    completed, failed = mod.runScenariosWithLimit("pane", files, max_concurrent=7)

    assert peak["value"] <= 7
    assert len(completed) == 20
    assert failed == []


def test_launchScenario_includes_model_flag(tmp_path, monkeypatch):
    """When a model is given, the /run-scenario command carries --model <model>."""
    sent = []
    monkeypatch.setattr(mod, "EXECUTED_DIR", tmp_path / "executed")
    monkeypatch.setattr(mod, "tmux_sendAndSubmit", lambda pane, cmd: sent.append(cmd))

    mod.launchScenario("pane", tmp_path / "s1.txt", 0, 1, model="claude-opus-4-6[1m]")

    assert sent and sent[0].endswith("--model claude-opus-4-6[1m]")
    assert "/run-scenario " in sent[0]


def test_launchScenario_omits_model_flag_when_empty(tmp_path, monkeypatch):
    """With no model, the command has no --model suffix."""
    sent = []
    monkeypatch.setattr(mod, "EXECUTED_DIR", tmp_path / "executed")
    monkeypatch.setattr(mod, "tmux_sendAndSubmit", lambda pane, cmd: sent.append(cmd))

    mod.launchScenario("pane", tmp_path / "s1.txt", 0, 1)

    assert sent and "--model" not in sent[0]
