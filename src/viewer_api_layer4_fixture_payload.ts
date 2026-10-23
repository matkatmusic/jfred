// Layer 4 fixture payload: the canned script runs grouped by pair path, as /api/layer1-script-runs answers them.

import type { WireScriptRunOf, WireScriptRunsViewOf } from "../webapp/layer1-wire.ts";
import { LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS } from "./layer1_script_runs_wire.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { COMMITS, DISK, buildSessionFile, buildSessionId, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import { SCRIPT_RUNS, type FixtureScriptRun } from "./viewer_api_layer4_fixture_data.ts";

// Moved to layer1_script_runs_wire.ts (task l4-wire-real).
// export const LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS = "reading script runs";

type FixtureScriptRunsView = WireScriptRunsViewOf<Date, Path, Uuid>;
type FixtureWireScriptRun = Omit<WireScriptRunOf<Date, Path, Uuid>, "axisPx">;

// A pair path is in a commit AND on disk; a git-only path draws nowhere.
function listPairPaths(): Set<string> {
  const diskPaths = new Set(DISK.map((row) => row.path));
  return new Set(COMMITS.flatMap((commit) => commit.files).filter((path) => diskPaths.has(path)));
}

function buildWireScriptRun(run: FixtureScriptRun): FixtureWireScriptRun {
  return {
    instant: new Date(parseMs(run.at)),
    toolUseId: new Uuid(run.toolUseId),
    executorKind: run.executorKind,
    code: run.code.join("\n"),
    ...(run.label === undefined ? {} : { label: run.label }),
    sessionId: buildSessionId(run.session),
    sessionFile: buildSessionFile(run.session),
  };
}

// One progress line per run; each run joins every pair path it names.
export function buildFixtureScriptRunsPayload(writeNdjsonLine: (value: unknown) => void): FixtureScriptRunsView {
  const pairPaths = listPairPaths();
  const runsByPath = new Map<string, FixtureWireScriptRun[]>();
  SCRIPT_RUNS.forEach((run, index) => {
    writeNdjsonLine({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS,
      current: index + 1, total: SCRIPT_RUNS.length });
    const wireRun = buildWireScriptRun(run);
    for (const path of run.paths.filter((candidate) => pairPaths.has(candidate))) {
      runsByPath.set(path, [...(runsByPath.get(path) ?? []), wireRun]);
    }
  });
  return { pairs: [...runsByPath].map(([path, scriptRuns]) => ({ path: new Path(path), scriptRuns })) };
}
