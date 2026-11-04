// Layer 6 fixture runs: python runs in far-apart bulk bubbles for the blocked, crashed, skipped, slow and outcome cases.

import { WireScriptExecutorKind } from "../webapp/layer1-wire-script-runs.ts";
import { WireScriptLanguage } from "../webapp/layer1-script-language.ts";
import type { FixtureScriptRun } from "./viewer_api_layer4_fixture_data.ts";

export const FIXTURE_RUN_ID = {
  pre: "toolu_fixture_l6_pre",
  blocker: "toolu_fixture_l6_blocker",
  blocked: "toolu_fixture_l6_blocked",
  crashBlocker: "toolu_fixture_l6_crash_blocker",
  crashBlocked: "toolu_fixture_l6_crash_blocked",
  skipBash: "toolu_fixture_l6_skip_bash",
  skipFailed: "toolu_fixture_l6_skip_failed",
  skipAfter: "toolu_fixture_l6_skip_after",
  slow: "toolu_fixture_l6_slow",
  replayMismatch: "toolu_fixture_l6_replay_mismatch",
  replayNotReplayed: "toolu_fixture_l6_replay_not_replayed",
} as const;

const BLOCKER_PATH = "scripts/ci/module_20.tsx";
const BLOCKED_PATH = "docs/guides/module_75.py";
const CRASH_BLOCKER_PATH = "lib/parse/module_38.tsx";
const CRASH_BLOCKED_PATH = "scripts/ci/module_62.tsx";
const SKIP_PATH = "scripts/ci/module_48.ts";

function buildFixturePythonRun(toolUseId: string, session: string, path: string, at: string, line: number): FixtureScriptRun {
  return { toolUseId, executorKind: WireScriptExecutorKind.python, language: WireScriptLanguage.python,
    line, at, session, paths: [path], code: ["import pathlib", `pathlib.Path("${path}").write_text("# fixture\\n")`] };
}

// Bulk bubbles far apart on both scroll axes; each run is 8.5 hours after its file was born.
export const L6_FIXTURE_RUNS: FixtureScriptRun[] = [
  buildFixturePythonRun(FIXTURE_RUN_ID.blocker, "bulk-1.jsonl", BLOCKER_PATH, "2026-06-11T13:30:00Z", 101),
  buildFixturePythonRun(FIXTURE_RUN_ID.blocked, "bulk-6.jsonl", BLOCKED_PATH, "2026-06-27T14:30:00Z", 102),
  buildFixturePythonRun(FIXTURE_RUN_ID.crashBlocker, "bulk-3.jsonl", CRASH_BLOCKER_PATH, "2026-06-16T19:30:00Z", 103),
  buildFixturePythonRun(FIXTURE_RUN_ID.crashBlocked, "bulk-5.jsonl", CRASH_BLOCKED_PATH, "2026-06-23T19:30:00Z", 104),
  { toolUseId: FIXTURE_RUN_ID.skipBash, executorKind: WireScriptExecutorKind.bash, language: WireScriptLanguage.bash,
    line: 105, at: "2026-06-19T17:30:00Z", session: "bulk-4.jsonl", paths: [SKIP_PATH],
    code: [`echo "# fixture" > ${SKIP_PATH}`] },
  buildFixturePythonRun(FIXTURE_RUN_ID.skipFailed, "bulk-4.jsonl", SKIP_PATH, "2026-06-19T18:30:00Z", 106),
  buildFixturePythonRun(FIXTURE_RUN_ID.skipAfter, "bulk-4.jsonl", SKIP_PATH, "2026-06-19T19:30:00Z", 107),
  buildFixturePythonRun(FIXTURE_RUN_ID.slow, "bulk-1.jsonl", "src/api/module_14.tsx", "2026-06-09T19:30:00Z", 108),
  buildFixturePythonRun(FIXTURE_RUN_ID.replayMismatch, "bulk-0.jsonl", "lib/parse/module_10.sh", "2026-06-08T15:30:00Z", 109),
  buildFixturePythonRun(FIXTURE_RUN_ID.replayNotReplayed, "bulk-2.jsonl", "docs/guides/module_26.tsx", "2026-06-13T07:30:00Z", 110),
];
