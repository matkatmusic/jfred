// Beaconless script detection, split from reconstruction_script_stage.ts (task 115): run scripts forward, chain runs on target content.

import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import {
  computeScriptExecutionChangeId,
  formatRunSource,
  type ScriptExecutionEvent,
  type ScriptRun,
} from "./reconstruction_script_execution.ts";
import { isScriptCodeWriteCapable, type LineageContentBefore } from "./reconstruction_script_prestate.ts";
import { runScriptAgainstState } from "./reconstruction_script_sandbox.ts";
import { executeRunOnce } from "./reconstruction_script_runs.ts";
import { refForTarget, runTouchesTarget } from "./reconstruction_script_probe.ts";

// The target's state on its chained lineage: its sandbox key and its content after the last injected run.
type RollingTargetState = { key: string; content: string };

// The content of `target` after `run`, or undefined if unchanged; rolling state seeds a sandbox re-run.
function getRunOutcomeForTarget(
  run: ScriptRun,
  target: Path,
  records: TranscriptRecord[],
  reader: BackupReader,
  seedContent: LineageContentBefore | undefined,
  rolling: RollingTargetState | undefined,
): RollingTargetState | undefined {
  // Item 68: a read-only run never produces an outcome, so bail before any sandbox work.
  if (!isScriptCodeWriteCapable(run.code))
    return undefined;
  if (rolling === undefined) {
    const basename = target.toString().split("/").pop() ?? "";
    if (!run.code.includes(basename) && !runTouchesTarget(run, target, records, reader, seedContent)) {
      return undefined;
    }
    const { pre: preState, post: postState } = executeRunOnce(run, records, reader, seedContent);
    if (postState === undefined)
      return undefined;
    // post keys included so a file the script CREATES resolves to its ref.
    const ref = refForTarget(target, [...preState.keys(), ...postState.keys()]);
    if (ref === undefined)
      return undefined;
    const pre = preState.get(ref);
    const post = postState.get(ref);
    // An undefined pre with a defined post is a legitimate birth.
    if (post === undefined || pre === post)
      return undefined;
    return { key: ref, content: post };
  }
  const { pre: preState } = executeRunOnce(run, records, reader, seedContent);
  const augmentedPre = new Map(preState);
  augmentedPre.set(rolling.key, rolling.content);
  const postState = runScriptAgainstState(run.code, augmentedPre, formatRunSource(run), run.cwd);
  if (postState === undefined)
    return undefined;
  const content = postState.get(rolling.key);
  if (content === undefined || content === rolling.content)
    return undefined;
  return { key: rolling.key, content };
}

// Run scripts to find unechoed file changes and inject a ScriptExecutionEvent; later runs chain on rolling content.
export function findBeaconlessScriptExecutions(
  target: Path,
  runs: ScriptRun[],
  records: TranscriptRecord[],
  reader: BackupReader,
  seedContent?: LineageContentBefore,
): ScriptExecutionEvent[] {
  const events: ScriptExecutionEvent[] = [];
  let rolling: RollingTargetState | undefined;
  for (const run of runs) {
    const outcome = getRunOutcomeForTarget(run, target, records, reader, seedContent, rolling);
    if (outcome === undefined)
      continue;
    events.push({
      kind: EventKind.scriptExecution,
      changeId: computeScriptExecutionChangeId(run, target),
      target,
      content: outcome.content,
      timestamp: run.timestamp,
    });
    rolling = outcome;
  }
  return events;
}
