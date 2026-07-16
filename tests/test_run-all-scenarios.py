"""Tests for run-all-scenarios.py pure helpers (no tmux side effects)."""

import importlib.util
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parent.parent / "run-all-scenarios.py"


def loadModule():
    """Import the hyphenated run-all-scenarios.py as a module object."""
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


def test_copyFilesInDir_copies_only_regular_files(tmp_path):
    """copyFilesInDir copies regular files (not subdirs) and returns the count."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.txt").write_text("a")
    (src / "b.txt").write_text("b")
    (src / "sub").mkdir()
    dest = tmp_path / "dest"
    dest.mkdir()

    count = mod.copyFilesInDir(src, dest)

    assert count == 2
    assert (dest / "a.txt").read_text() == "a"
    assert not (dest / "sub").exists()


def test_extractTmpdirFromResultText():
    """The tmpdir line is parsed out of result text."""
    text = "header\ntmpdir: /tmp/scn-123\nresult: {}"
    assert mod.extractTmpdirFromResultText(text) == "/tmp/scn-123"


def test_extractJsonlPathsFromResultText_list_and_fallback():
    """jsonl_paths is preferred; falls back to [jsonl_path] when only the single key is present."""
    multi = 'result: {"jsonl_paths": ["/a.jsonl", "/b.jsonl"], "completed": true}'
    assert mod.extractJsonlPathsFromResultText(multi) == ["/a.jsonl", "/b.jsonl"]
    single = 'tmpdir: /tmp/x\nresult: {"jsonl_path": "/tmp/x/sess.jsonl", "completed": true}'
    assert mod.extractJsonlPathsFromResultText(single) == ["/tmp/x/sess.jsonl"]


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


def test_copyScenarioOutputsToExecutedDir_captures_repo_subdir(tmp_path):
    """Subdirectories (e.g. .git) are captured recursively, not just top-level files."""
    src = tmp_path / "src"
    (src / ".git").mkdir(parents=True)
    (src / ".git" / "HEAD").write_text("ref: refs/heads/main")
    (src / "mod.py").write_text("x = 1")
    dest_root = tmp_path / "executed"
    mod.copyScenarioOutputsToExecutedDir(str(src), "s99", executed_dir=dest_root)
    out = dest_root / "s99"
    assert (out / "mod.py").is_file()
    assert (out / ".git" / "HEAD").read_text() == "ref: refs/heads/main"


def test_copyScenarioOutputs_captures_step_states(tmp_path):
    """The .step_states/ snapshot tree is captured into executed/<stem>/ for the engine."""
    src = tmp_path / "src"
    (src / ".step_states" / "step-001").mkdir(parents=True)
    (src / ".step_states" / "step-001" / "mod.py").write_text("x = 1")
    dest_root = tmp_path / "executed"
    mod.copyScenarioOutputsToExecutedDir(str(src), "s99", executed_dir=dest_root)
    out = dest_root / "s99"
    assert (out / ".step_states" / "step-001" / "mod.py").read_text() == "x = 1"


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
