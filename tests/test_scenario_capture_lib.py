"""Tests for scenario_capture_lib.py — copy-on-completion helpers."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scenario_capture_lib import (
    captureCompletedScenario,
    copyFilesInDir,
    copyScenarioJsonlToExecutedDir,
    copyScenarioOutputsToExecutedDir,
    extractJsonlPathsFromResultText,
    extractTmpdirFromResultText,
)


def test_extractTmpdirFromResultText_returnsTheTmpdirValue():
    # The result text contains a "tmpdir: <path>" line among other lines.
    # extractTmpdirFromResultText should return just the path value.
    text = (
        "scenario: s1\n"
        "tmpdir: /private/tmp/scenario-abc123\n"
        'result: {"completed": true, "jsonl_path": "/some/path.jsonl"}\n'
    )

    result = extractTmpdirFromResultText(text)

    assert result == "/private/tmp/scenario-abc123"


def test_extractJsonlPathsFromResultText_list_and_fallback():
    # jsonl_paths is preferred; falls back to [jsonl_path] when only the single key is present.
    multi = 'result: {"jsonl_paths": ["/a.jsonl", "/b.jsonl"], "completed": true}'
    assert extractJsonlPathsFromResultText(multi) == ["/a.jsonl", "/b.jsonl"]
    single = 'tmpdir: /tmp/x\nresult: {"jsonl_path": "/tmp/x/sess.jsonl", "completed": true}'
    assert extractJsonlPathsFromResultText(single) == ["/tmp/x/sess.jsonl"]


def test_copyFilesInDir_copies_only_regular_files(tmp_path):
    # copyFilesInDir copies regular files (not subdirs) and returns the count.
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.txt").write_text("a")
    (src / "b.txt").write_text("b")
    (src / "sub").mkdir()
    dest = tmp_path / "dest"
    dest.mkdir()

    count = copyFilesInDir(src, dest)

    assert count == 2
    assert (dest / "a.txt").read_text() == "a"
    assert not (dest / "sub").exists()


def test_copyScenarioOutputsToExecutedDir_copiesTopLevelAndTestsFiles(tmp_path):
    # Build a fake tmpdir with a top-level file and a tests/ subdirectory file.
    # copyScenarioOutputsToExecutedDir should copy both into EXECUTED_DIR/<stem>/.
    fake_tmpdir = tmp_path / "tmpdir"
    fake_tmpdir.mkdir()
    (fake_tmpdir / "hello.py").write_text("print('hello')")
    tests_sub = fake_tmpdir / "tests"
    tests_sub.mkdir()
    (tests_sub / "test_hello.py").write_text("def test_it(): pass")

    executed_dir = tmp_path / "executed"
    executed_dir.mkdir()

    count = copyScenarioOutputsToExecutedDir(fake_tmpdir, "s1", executed_dir)

    assert count == 2
    assert (executed_dir / "s1" / "hello.py").read_text() == "print('hello')"
    assert (executed_dir / "s1" / "tests" / "test_hello.py").read_text() == "def test_it(): pass"


def test_copyScenarioOutputsToExecutedDir_wipesStaleFilesFromPriorRun(tmp_path):
    # A prior run left a stale file in executed/s1/. The new copy should
    # wipe the directory first so the stale file does not survive.
    executed_dir = tmp_path / "executed"
    stale_dir = executed_dir / "s1"
    stale_dir.mkdir(parents=True)
    (stale_dir / "stale_old.py").write_text("old content")

    fake_tmpdir = tmp_path / "tmpdir"
    fake_tmpdir.mkdir()
    (fake_tmpdir / "fresh.py").write_text("new content")

    copyScenarioOutputsToExecutedDir(fake_tmpdir, "s1", executed_dir)

    assert (executed_dir / "s1" / "fresh.py").read_text() == "new content"
    assert not (executed_dir / "s1" / "stale_old.py").exists()


def test_copyScenarioOutputsToExecutedDir_captures_repo_subdir(tmp_path):
    # Subdirectories (e.g. .git) are captured recursively, not just top-level files.
    src = tmp_path / "src"
    (src / ".git").mkdir(parents=True)
    (src / ".git" / "HEAD").write_text("ref: refs/heads/main")
    (src / "mod.py").write_text("x = 1")
    dest_root = tmp_path / "executed"
    copyScenarioOutputsToExecutedDir(str(src), "s99", executed_dir=dest_root)
    out = dest_root / "s99"
    assert (out / "mod.py").is_file()
    assert (out / ".git" / "HEAD").read_text() == "ref: refs/heads/main"


def test_copyScenarioOutputs_captures_step_states(tmp_path):
    # The .step_states/ snapshot tree is captured into executed/<stem>/ for the engine.
    src = tmp_path / "src"
    (src / ".step_states" / "step-001").mkdir(parents=True)
    (src / ".step_states" / "step-001" / "mod.py").write_text("x = 1")
    dest_root = tmp_path / "executed"
    copyScenarioOutputsToExecutedDir(str(src), "s99", executed_dir=dest_root)
    out = dest_root / "s99"
    assert (out / ".step_states" / "step-001" / "mod.py").read_text() == "x = 1"


def test_copyScenarioJsonlToExecutedDir_copiesJsonlIntoSubfolder(tmp_path):
    # A JSONL file at some path should be copied into EXECUTED_DIR/<stem>/
    # keeping its original filename.
    jsonl_src = tmp_path / "source" / "abc-1234.jsonl"
    jsonl_src.parent.mkdir()
    jsonl_src.write_text('{"type":"system"}\n')

    executed_dir = tmp_path / "executed"
    executed_dir.mkdir()

    dest = copyScenarioJsonlToExecutedDir(jsonl_src, "s1", executed_dir)

    assert dest == executed_dir / "s1" / "abc-1234.jsonl"
    assert dest.read_text() == '{"type":"system"}\n'


def test_captureCompletedScenario_placesOutputsAndJsonlTogether(tmp_path):
    # captureCompletedScenario orchestrates extraction + copying.
    # After one call, the executed/<stem>/ dir should have both ground-truth
    # files and the .jsonl together.
    fake_tmpdir = tmp_path / "tmpdir"
    fake_tmpdir.mkdir()
    (fake_tmpdir / "output.py").write_text("x = 1")

    jsonl_src = tmp_path / "jsonls" / "session-uuid.jsonl"
    jsonl_src.parent.mkdir()
    jsonl_src.write_text('{"type":"system"}\n')

    executed_dir = tmp_path / "executed"
    executed_dir.mkdir()

    result_text = (
        "scenario: s5\n"
        f"tmpdir: {fake_tmpdir}\n"
        f'result: {{"completed": true, "jsonl_path": "{jsonl_src}"}}\n'
    )

    captureCompletedScenario(result_text, "s5", executed_dir)

    stem_dir = executed_dir / "s5"
    assert (stem_dir / "output.py").read_text() == "x = 1"
    assert (stem_dir / "session-uuid.jsonl").read_text() == '{"type":"system"}\n'
