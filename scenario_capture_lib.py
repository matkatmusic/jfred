#!/usr/bin/env python3
"""Capture helpers for run-all-scenarios.py: copy a finished scenario's tmpdir
tree and session JSONLs into executed/<stem>/."""

import json
import shutil
from pathlib import Path

# Executed runs live in scenarios/executed/ — the canonical copy the jfred tests read.
EXECUTED_DIR = Path(__file__).parent / "scenarios" / "executed"


def extractTmpdirFromResultText(text):
    """Return the tmpdir path from a result text's 'tmpdir: <path>' line."""
    for line in text.splitlines():
        if line.startswith("tmpdir: "):
            return line[len("tmpdir: "):]
    return ""


def extractJsonlPathsFromResultText(text):
    """Return all jsonl paths to capture: the 'jsonl_paths' list, or [jsonl_path] fallback."""
    for line in text.splitlines():
        if line.startswith("result: "):
            payload = json.loads(line[len("result: "):])
            paths = payload.get("jsonl_paths") or []
            single = payload.get("jsonl_path")
            return paths if paths else ([single] if single else [])
    return []


def copyFilesInDir(src_dir, dest_dir):
    """Copy every regular file directly under src_dir into dest_dir; return count."""
    copied = 0
    for f in Path(src_dir).iterdir():
        if f.is_file():
            shutil.copy2(str(f), str(Path(dest_dir) / f.name))
            copied += 1
    return copied


def copyScenarioOutputsToExecutedDir(tmpdir, stem, executed_dir=EXECUTED_DIR):
    """Copy tmpdir's files and every subdir (tests/, .git, pkg/, ...) into executed/<stem>/."""
    output_dir = executed_dir / stem
    if output_dir.is_dir():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    copied = copyFilesInDir(tmpdir, output_dir)
    for sub in Path(tmpdir).iterdir():
        if sub.is_dir():
            shutil.copytree(sub, output_dir / sub.name)
            copied += sum(1 for p in (output_dir / sub.name).rglob("*") if p.is_file())
    return copied


def copyScenarioJsonlToExecutedDir(jsonl_path, stem, executed_dir=EXECUTED_DIR):
    """Copy the session JSONL into executed/<stem>/ keeping its filename."""
    output_dir = executed_dir / stem
    output_dir.mkdir(parents=True, exist_ok=True)
    src = Path(jsonl_path)
    dest = output_dir / src.name
    shutil.copy2(str(src), str(dest))
    return dest


def captureCompletedScenario(result_text, stem, executed_dir=EXECUTED_DIR):
    """Copy the tmpdir tree and every session JSONL into executed/<stem>/."""
    tmpdir = extractTmpdirFromResultText(result_text)
    if tmpdir:
        copyScenarioOutputsToExecutedDir(tmpdir, stem, executed_dir)
    # Copy ALL JSONLs from the Claude project directory, not just the ones
    # the Record step captured — /clear and /compact create new sessions
    # whose JSONLs aren't in the result's jsonl_paths.
    known = extractJsonlPathsFromResultText(result_text)
    if known:
        project_dir = Path(known[0]).parent
        for jsonl in sorted(project_dir.glob("*.jsonl")):
            copyScenarioJsonlToExecutedDir(str(jsonl), stem, executed_dir)
