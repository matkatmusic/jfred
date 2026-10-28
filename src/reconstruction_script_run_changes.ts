// Per-run file changes captured from the script sandbox diff, for the timeline's script-run rows.

import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { type BackupReader } from "./reconstruction_sidecar.ts";
import { findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { isJunkStateKey } from "./reconstruction_script_sandbox.ts";
import { matchRenamePairs } from "./reconstruction_script_renames.ts";
import { executeRunOnce } from "./reconstruction_script_runs.ts";

// A move the sandbox diff proves, resolved to absolute paths (task 143; matcher in reconstruction_script_renames.ts).
export type ScriptRenamePair = { from: Path; to: Path };

// A script run's file changes, captured once (task 67) and reused (task 143) for the timeline's script-run rows.
export type ScriptRunFileChanges = {
  toolUseId: Uuid | undefined;
  timestamp: Date;
  code: string;
  changedPaths: Path[];
  renamedPaths: ScriptRenamePair[];
};

export function collectScriptRunFileChanges(
  records: TranscriptRecord[],
  reader: BackupReader | undefined,
): ScriptRunFileChanges[] {
  const results: ScriptRunFileChanges[] = [];
  for (const run of findScriptExecutionRuns(records)) {
    results.push({
      toolUseId: run.toolUseId,
      timestamp: run.timestamp,
      code: run.code,
      ...computeRunFileOutcome(run, records, reader),
    });
  }
  return results;
}

// Paths executeRunOnce's diff shows changed; empty when execution is declined or no sidecar reader exists (task 143).
function computeRunFileOutcome(
  run: ScriptRun,
  records: TranscriptRecord[],
  reader: BackupReader | undefined,
): { changedPaths: Path[]; renamedPaths: ScriptRenamePair[] } {
  if (reader === undefined)
    return { changedPaths: [], renamedPaths: [] };
  const isExecutionAllowed = isImpureExecutionAllowed();
  if (!isExecutionAllowed)
    return { changedPaths: [], renamedPaths: [] };
  const execution = executeRunOnce(run, records, reader);
  if (execution.post === undefined)
    return { changedPaths: [], renamedPaths: [] };
  const pairs = matchRenamePairs(execution.pre, execution.post);
  const pairSourceKeys = new Set<string>();
  for (const pair of pairs)
    pairSourceKeys.add(pair.fromKey);
  const changed = new Map<string, Path>();
  for (const key of new Set([...execution.pre.keys(), ...execution.post.keys()])) {
    const isJunk = isJunkStateKey(key);
    if (isJunk)
      continue;
    const isRenameSource = pairSourceKeys.has(key);
    if (isRenameSource)
      continue;
    const isUnchanged = execution.pre.get(key) === execution.post.get(key);
    if (isUnchanged)
      continue;
    const absolute = resolveAgainstCwd(run.cwd, new Path(key));
    const isAlreadyChanged = changed.has(absolute);
    if (!isAlreadyChanged)
      changed.set(absolute, new Path(absolute));
  }
  const renamedPaths: ScriptRenamePair[] = [];
  for (const pair of pairs) {
    renamedPaths.push({
      from: new Path(resolveAgainstCwd(run.cwd, new Path(pair.fromKey))),
      to: new Path(resolveAgainstCwd(run.cwd, new Path(pair.toKey))),
    });
  }
  return { changedPaths: [...changed.values()], renamedPaths };
}
