#!/usr/bin/env python3
"""Entry point for JFRED's /run-scenario skill.

Routes the UserPromptSubmit hook payload (stdin JSON) and the argv-mode
run-scenario-* subcommands (fired by the driven agent's generated hooks) to
run_scenario_lib. Unconsumed prompts exit 0 with empty stdout (silent
passthrough, so Claude Code processes the prompt normally).
"""
from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))
# run_scenario_lib + bg_permissions_lib locate the repo root and the permissions
# asset (assets/bg_agent_permissions.json) through the plugin env contract;
# standalone JFRED provides both here.
os.environ.setdefault("CLAUDE_PLUGIN_ROOT", str(_ROOT))
os.environ.setdefault("CLAUDE_PLUGIN_DATA", str(_ROOT / ".plugin_data"))

from external.claude_plugin_lib.util_lib import _util_matches_prefix  # noqa: E402
from common.scripts.run_scenario_lib import (  # noqa: E402
    runScenario_execute,
    runScenario_launch,
    runScenario_launchAndExecute,
    runScenario_main,
    runScenario_saveTxtAsJson,
    runScenario_sessionEnd,
    runScenario_sessionStart,
    runScenario_stop,
)

# Argv subcommand -> adapter unpacking argv into the lib function's positional
# contract (mirrors jot's orchestrator routing for the run-scenario slice).
_ARGV_DISPATCH: dict = {
    "run-scenario-launch": lambda argv: runScenario_launch(*argv),
    "run-scenario-session-start": lambda argv: runScenario_sessionStart(*argv),
    "run-scenario-stop": lambda argv: runScenario_stop(*argv),
    "run-scenario-session-end": lambda argv: runScenario_sessionEnd(*argv),
    "run-scenario-execute": lambda argv: runScenario_execute(*argv),
    "run-scenario-launch-and-execute": lambda argv: runScenario_launchAndExecute(*argv),
    "run-scenario-convert": lambda argv: print(runScenario_saveTxtAsJson(argv[0])) or 0,
}


def main() -> int:
    argv = sys.argv[1:]
    if argv:
        fn = _ARGV_DISPATCH.get(argv[0])
        if fn is None:
            return 0
        rc = fn(argv[1:])
        return 0 if rc is None else int(rc)

    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {}
    prompt = (data.get("prompt", "") if isinstance(data, dict) else "").lstrip()
    if _util_matches_prefix(prompt, "/run-scenario"):
        # runScenario_main reads the hook payload from stdin itself; re-pipe it.
        sys.stdin = io.StringIO(raw)
        rc = runScenario_main()
        return 0 if rc is None else int(rc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
