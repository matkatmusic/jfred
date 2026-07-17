#!/usr/bin/env python3
"""Run scenario.txt files through /run-scenario in a Claude tmux session.

Usage:
    python3 run-all-scenarios.py <pane_target> [--only <scenario>] [--skip-existing]

Fires the selected scenarios with 30s spacing, then polls until all finish.
--only <file> runs just that one; --skip-existing drops scenarios that already
have a captured run in executed/<stem>/.
"""

import argparse
import re
import sys
import time
from pathlib import Path

from scenario_capture_lib import EXECUTED_DIR, captureCompletedScenario
from external.tmux_lib.tmux_lib import tmux_sendAndSubmit, tmux_waitForClaudeReadiness

SCENARIOS_DIR = Path(__file__).parent / "scenarios"
LAUNCH_SPACING_S = 30
POLL_INTERVAL_S = 15
POLL_TIMEOUT_S = 1800
MAX_CONCURRENT_SESSIONS = 3
DEFAULT_AGENT_MODEL = "claude-opus-4-6[1m]"


def findScenarioFiles():
    """Return sorted list of scenario .txt files in the scenarios directory."""
    return sorted(SCENARIOS_DIR.glob("*.txt"))


def findLatestExecutedFile(stem):
    """Find the most recent executed file for a scenario stem."""
    if not EXECUTED_DIR.is_dir():
        return None
    matches = sorted(EXECUTED_DIR.glob(f"{stem}-run-*.txt"))
    if matches:
        return matches[-1]
    return None


def hasCapturedRun(stem):
    """True if executed/<stem>/.step_states/ exists — the per-step snapshots the
    reconstruction engine needs are present, so the scenario can be skipped."""
    return (EXECUTED_DIR / stem / ".step_states").is_dir()


def executedFileHasResult(executed_file):
    """Check if an executed file contains a 'result:' line."""
    if not executed_file:
        return False
    if not executed_file.is_file():
        return False
    text = executed_file.read_text()
    return "result:" in text


def resolveOnlyScenario(only):
    """Resolve an --only value (path, filename, bare stem, or prefix like 's68') to a scenario .txt path."""
    candidate = Path(only)
    if candidate.is_file():
        return candidate.resolve()
    stem = candidate.name[:-4] if candidate.name.endswith(".txt") else candidate.name
    direct = SCENARIOS_DIR / f"{stem}.txt"
    if direct.is_file():
        return direct.resolve()
    prefix = stem + "-"
    matches = sorted(f for f in SCENARIOS_DIR.glob("*.txt") if f.stem.startswith(prefix))
    if len(matches) == 1:
        return matches[0].resolve()
    return None


def selectScenarioFiles(only, skip_existing=False):
    """Return scenario files to run: all, or just --only; optionally drop already-run ones."""
    if only:
        match = resolveOnlyScenario(only)
        if match is None:
            print(f"ERROR: no scenario file matches --only {only!r} in {SCENARIOS_DIR}")
            sys.exit(1)
        files = [match]
    else:
        files = findScenarioFiles()
    if skip_existing:
        for f in [x for x in files if hasCapturedRun(x.stem)]:
            print(f"  SKIP (already run): {f.stem}")
        files = [f for f in files if not hasCapturedRun(f.stem)]
    return files


def ensureClaudeReady(pane_target):
    """Confirm (or launch) a Claude Code session in the pane; exit on failure."""
    print(f"Checking for Claude Code session in pane {pane_target}...")
    if tmux_waitForClaudeReadiness(pane_target, timeout=5) == 0:
        print("Claude Code ready.\n")
        return
    print("No Claude Code session detected. Launching claude...")
    tmux_sendAndSubmit(pane_target, "claude")
    if tmux_waitForClaudeReadiness(pane_target, timeout=30) != 0:
        print("ERROR: Claude Code failed to start within 30s.")
        sys.exit(1)
    print("Claude Code ready.\n")


def launchScenario(pane_target, scenario_file, index, total, model=""):
    """Clean stale executed files for one scenario, then fire its /run-scenario."""
    stem = scenario_file.stem
    if EXECUTED_DIR.is_dir():
        for old in EXECUTED_DIR.glob(f"{stem}-run-*.txt"):
            old.unlink()
    print(f"[{index + 1}/{total}] Sending: {stem}")
    command = f"/run-scenario {scenario_file.resolve()}"
    if model:
        command += f" --model {model}"
    tmux_sendAndSubmit(pane_target, command)
    return stem


def parseStepProgress(text):
    """Return (first unchecked step number, its text, total steps) from a progress copy, or None."""
    steps = re.findall(r"^- \[( |x)\] (\d+)\. (.*)$", text, re.MULTILINE)
    unchecked = [(int(num), body) for mark, num, body in steps if mark == " "]
    if not unchecked:
        return None
    num, body = unchecked[0]
    return num, body, len(steps)


def reportStepProgress(stem, last_reported):
    """Print which step a running scenario is on, once per advance; True if it advanced."""
    executed_file = findLatestExecutedFile(stem)
    if executed_file is None:
        return False
    progress = parseStepProgress(executed_file.read_text())
    if progress is None:
        return False
    num, body, total = progress
    if last_reported.get(stem) == num:
        return False
    last_reported[stem] = num
    print(f"  sending step {num}/{total}: {' '.join(body.split()[:10])}", flush=True)
    return True


def recordScenarioOutcome(stem, completed, failed):
    """Capture a finished scenario into its bucket; return True once it has a result."""
    executed_file = findLatestExecutedFile(stem)
    if executed_file is None or not executedFileHasResult(executed_file):
        return False
    text = executed_file.read_text()
    if '"completed": true' in text:
        captureCompletedScenario(text, stem)
        completed.append(stem)
        print(f"  COMPLETED: {stem}")
    else:
        failed.append(stem)
        print(f"  FAILED: {stem}")
    return True


def reapFinishedSessions(running, completed, failed):
    """Capture finished or timed-out sessions, removing each from the running map."""
    for stem in list(running):
        if recordScenarioOutcome(stem, completed, failed):
            del running[stem]
            continue
        if time.time() > running[stem]:
            failed.append(stem)
            print(f"  TIMEOUT: {stem}")
            del running[stem]


def bumpDeadlinesOnProgress(running, last_reported):
    """Reset the stall deadline of every scenario that advanced a step since last poll."""
    for stem in running:
        if reportStepProgress(stem, last_reported):
            running[stem] = time.time() + POLL_TIMEOUT_S


def fillOpenSlots(pane_target, queue, running, next_index, max_concurrent, model=""):
    """Launch queued scenarios into open slots (spacing the burst); return new index."""
    total = len(queue)
    while len(running) < max_concurrent and next_index < total:
        stem = launchScenario(pane_target, queue[next_index], next_index, total, model)
        running[stem] = time.time() + POLL_TIMEOUT_S
        next_index += 1
        if len(running) < max_concurrent and next_index < total:
            time.sleep(LAUNCH_SPACING_S)
    return next_index


def runScenariosWithLimit(pane_target, scenario_files, max_concurrent=MAX_CONCURRENT_SESSIONS, model=""):
    """Run scenarios keeping at most max_concurrent sessions in flight at once.

    Fills open slots from the queue, polls the running sessions, and frees each slot
    the moment its scenario finishes or stalls: the POLL_TIMEOUT_S deadline is
    reset every time a scenario advances a step, so only a session with no step
    progress for POLL_TIMEOUT_S is reaped as TIMEOUT. Returns (completed, failed) stems.
    """
    queue = list(scenario_files)
    running = {}          # stem -> per-session timeout deadline
    completed = []
    failed = []
    next_index = 0
    last_reported = {}    # stem -> last step number printed

    while next_index < len(queue) or running:
        next_index = fillOpenSlots(pane_target, queue, running, next_index, max_concurrent, model)
        bumpDeadlinesOnProgress(running, last_reported)
        reapFinishedSessions(running, completed, failed)
        if running:
            time.sleep(POLL_INTERVAL_S)
    return completed, failed


def main():
    parser = argparse.ArgumentParser(description="Run scenario .txt files through /run-scenario.")
    parser.add_argument("pane_target", help="tmux pane where Claude is running")
    parser.add_argument("--only", metavar="FILE", help="run a single scenario (path, name, or stem)")
    parser.add_argument("--skip-existing", action="store_true", help="skip scenarios already captured in executed/<stem>/")
    model_help = f"model each spawned agent runs on via /model (default: {DEFAULT_AGENT_MODEL}; pass '' to skip)"
    parser.add_argument("--model", default=DEFAULT_AGENT_MODEL, help=model_help)
    sessions_help = f"max scenarios running simultaneously (default: {MAX_CONCURRENT_SESSIONS})"
    parser.add_argument("--maxSessions", type=int, default=MAX_CONCURRENT_SESSIONS, help=sessions_help)
    args = parser.parse_args()

    pane_target = args.pane_target
    ensureClaudeReady(pane_target)
    scenario_files = selectScenarioFiles(args.only, args.skip_existing)
    if not scenario_files:
        print("No scenarios to run (all selected ones already have captured runs).")
        return

    model_note = args.model or "default (no /model)"
    print(f"Found {len(scenario_files)} scenario file(s) | pane {pane_target} | "
          f"max {args.maxSessions} concurrent | model {model_note}\n")

    completed, failed = runScenariosWithLimit(
        pane_target, scenario_files, max_concurrent=args.maxSessions, model=args.model
    )

    print(f"\nDone: {len(completed)} completed, {len(failed)} failed out of {len(scenario_files)}")
    if failed:
        print(f"Failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
