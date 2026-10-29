// Probes that find which recorded script run produced a target file's change.

import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { type BackupReader } from "./reconstruction_sidecar.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";
import { executeRunOnce } from "./reconstruction_script_runs.ts";

// The pre/post-state key that denotes `target`, or undefined when the run's sandbox never saw it.
export function findRefForTarget(target: Path, stateKeys: string[]): string | undefined {
  const targetStr = target.toString();
  for (const ref of stateKeys) {
    const isExactMatch = targetStr === ref;
    const isSuffixMatch = targetStr.endsWith(`/${ref}`);
    const isMatch = isExactMatch || isSuffixMatch;
    if (isMatch)
      return ref;
  }
  return undefined;
}

// Whether executing the run changes or creates `target`, even if the script only globs.
export function isRunTouchingTarget(
  run: ScriptRun,
  target: Path,
  records: TranscriptRecord[],
  reader: BackupReader,
  seedContent?: LineageContentBefore,
): boolean {
  const execution = executeRunOnce(run, records, reader, seedContent);
  if (execution.post === undefined)
    return false;
  const ref = findRefForTarget(target, [...execution.pre.keys(), ...execution.post.keys()]);
  if (ref === undefined)
    return false;
  const contentBefore = execution.pre.get(ref);
  const contentAfter = execution.post.get(ref);
  return contentAfter !== undefined && contentAfter !== contentBefore;
}

// A run's SOURCE names `target` by basename substring — static only, no execution.
function isPathNamedByRunSource(run: ScriptRun, target: Path): boolean {
  const segments = target.toString().split("/");
  const basename = segments.pop() ?? "";
  const hasBasename = basename !== "";
  return hasBasename && run.code.includes(basename);
}

// The latest run at or before `when` naming `target`, else the latest whose execution provably changes it.
export function findRunForTarget(
  runs: ScriptRun[],
  target: Path,
  when: Date,
  records: TranscriptRecord[],
  reader: BackupReader,
  seedContent?: LineageContentBefore,
): ScriptRun | undefined {
  let chosen: ScriptRun | undefined;
  for (const run of runs) {
    const isAfterWhen = run.timestamp.getTime() > when.getTime();
    if (isAfterWhen)
      continue;
    const isNamed = isPathNamedByRunSource(run, target);
    if (isNamed)
      chosen = run;
  }
  if (chosen !== undefined)
    return chosen;
  for (const run of runs) {
    const isAfterWhen = run.timestamp.getTime() > when.getTime();
    if (isAfterWhen)
      continue;
    const isTouching = isRunTouchingTarget(run, target, records, reader, seedContent);
    if (isTouching)
      chosen = run;
  }
  return chosen;
}

// Task 356: static-scan inverse of findRunForTarget; empty means unlabeled, never guessed.
export function findAffectedPathsForRun(run: ScriptRun, candidatePaths: Path[]): Path[] {
  const affected: Path[] = [];
  for (const target of candidatePaths) {
    const isNamed = isPathNamedByRunSource(run, target);
    if (isNamed)
      affected.push(target);
  }
  return affected;
}
