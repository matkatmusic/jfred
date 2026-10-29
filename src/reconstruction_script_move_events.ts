// Sandbox-proven script moves become rename events (task 155), the third script-rename evidence channel.

import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { normalizeAgainstCwd } from "./structures/path-resolve.ts";
import {
  computeScriptExecutionChangeId,
  findScriptExecutionRuns,
  type ScriptRun,
} from "./reconstruction_script_execution.ts";
import { matchRenamePairs } from "./reconstruction_script_renames.ts";
import { executeRunOnce, selectRunsWithinReplayWindow } from "./reconstruction_script_runs.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";

// The `${from}|${to}` key of a rename pair, used to dedupe across channels and runs.
function renamePairKeyOf(from: Path, to: Path): string {
  return `${from.toString()}|${to.toString()}`;
}

// Append one run's proven pairs as rename events, skipping pairs already evidenced; changeId is run x source path.
function appendPairsProvenByRun(
  run: ScriptRun,
  pre: Map<string, string>,
  post: Map<string, string>,
  knownPairKeys: Set<string>,
  appended: FileEvent[],
): void {
  for (const pair of matchRenamePairs(pre, post)) {
    const from = new Path(normalizeAgainstCwd(run.cwd, new Path(pair.fromKey)));
    const to = new Path(normalizeAgainstCwd(run.cwd, new Path(pair.toKey)));
    const pairKey = renamePairKeyOf(from, to);
    const isKnownPair = knownPairKeys.has(pairKey);
    if (isKnownPair) {
      continue;
    }
    knownPairKeys.add(pairKey);
    appended.push({
      kind: EventKind.rename,
      changeId: computeScriptExecutionChangeId(run, from),
      from,
      to,
      timestamp: run.timestamp,
    });
  }
}

// Append every sandbox-proven move as a rename event; declined or readerless builds return events unchanged.
export function appendScriptMoveRenames(
  events: FileEvent[],
  records: TranscriptRecord[],
  reader: BackupReader | undefined,
  seedContent?: LineageContentBefore,
): FileEvent[] {
  const isReaderless = reader === undefined;
  const isExecutionDeclined = !isImpureExecutionAllowed();
  const isUnavailable = isReaderless || isExecutionDeclined;
  if (isUnavailable) {
    return events;
  }
  const knownPairKeys = new Set<string>();
  for (const event of events) {
    if (event.kind === EventKind.rename) {
      knownPairKeys.add(renamePairKeyOf(event.from, event.to));
    }
  }
  const appended: FileEvent[] = [...events];
  for (const run of selectRunsWithinReplayWindow(findScriptExecutionRuns(records))) {
    const execution = executeRunOnce(run, records, reader, seedContent);
    if (execution.post === undefined) {
      continue;
    }
    appendPairsProvenByRun(run, execution.pre, execution.post, knownPairKeys, appended);
  }
  return appended;
}
