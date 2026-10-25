// Layer 4 fixture data: canned script runs and their resolved bodies.

import { WireScriptExecutorKind } from "../webapp/layer1-wire-script-runs.ts";
import { WireScriptLanguage } from "../webapp/layer1-script-language.ts";
// import { SESSIONS, parseMs } from "./viewer_api_layer1_fixture_data.ts";

export const SCRIPT_RUN_NODE_KIND = "scriptRun";

export interface FixtureScriptRun {
  toolUseId: string;
  executorKind: WireScriptExecutorKind;
  language: WireScriptLanguage;
  line: number;
  at: string;
  session: string;
  paths: string[];
  code: string[];
  label?: string;
}

export const SCRIPT_RUNS: FixtureScriptRun[] = [
  { toolUseId: "toolu_fixture_py_rewrite", executorKind: WireScriptExecutorKind.python,
    language: WireScriptLanguage.python, line: 83,
    at: "2026-06-01T09:03:00Z", session: "0f3c9a7e.jsonl", paths: ["src/index.ts", "src/util.ts"],
    label: "python run rewrite.py",
    code: ["import pathlib", "", 'for name in ["src/index.ts", "src/util.ts"]:',
      "    path = pathlib.Path(name)", '    path.write_text(path.read_text().replace("demo", "demo-app"))'] },
  { toolUseId: "toolu_fixture_sh_deploy", executorKind: WireScriptExecutorKind.bash,
    language: WireScriptLanguage.shell, line: 17,
    at: "2026-07-20T21:00:00Z", session: "7ce50a19.jsonl", paths: ["scripts/deploy.sh"],
    code: ["#!/usr/bin/env bash", "set -euo pipefail", "chmod +x scripts/deploy.sh", "./scripts/deploy.sh staging"] },
  { toolUseId: "toolu_fixture_sh_inline", executorKind: WireScriptExecutorKind.bash,
    language: WireScriptLanguage.bash, line: 5,
    at: "2026-06-02T10:00:00Z", session: "b21d84c5.jsonl", paths: ["src/util.ts"],
    code: ["cat <<'EOF' > src/util.ts", "export const trim = (text: string) => text.trim();", "EOF"] },
];

export function findFixtureScriptRun(toolUseId: string): FixtureScriptRun {
  for (const run of SCRIPT_RUNS) {
    if (run.toolUseId === toolUseId) {
      return run;
    }
  }
  throw new Error(`no fixture script run ${toolUseId}`);
}

// Moved to viewer_api_fixture_check.ts (task 343), which runs it from the bulk loader.
// function assertScriptRunsInSessions(): void {
//   for (const run of SCRIPT_RUNS) {
//     const runMs = parseMs(run.at);
//     let isInWindow = false;
//     for (const session of SESSIONS) {
//       const isOwner = session.file === run.session;
//       if (isOwner) {
//         isInWindow = runMs >= parseMs(session.started) && runMs <= parseMs(session.ended);
//       }
//     }
//     if (!isInWindow) {
//       throw new Error(`script run ${run.toolUseId} is outside session ${run.session}`);
//     }
//   }
// }
//
// assertScriptRunsInSessions();
