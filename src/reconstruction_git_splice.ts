// Splices committed-blob diffs into a lineage as synthetic user edits, split from reconstruction_git_placement.ts.

import { randomUUID } from "node:crypto";
import { EventKind } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";
import { addStageEntry } from "./reconstruction_provenance.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import type { FileEvent, UserEditEvent } from "./reconstruction_events.ts";
import { applyAdditions, extractPureAdditions, type LineAddition } from "./reconstruction_git_additions.ts";
import {
  applyScriptRunsOver,
  computeMidpointAfter,
  findFullContentIndices,
  type FullContentEvent,
} from "./reconstruction_git_replay.ts";

// Splice additions after baseIndex; accept only if forward replay reproduces the blob exactly.
export function insertAdditionsAfter(
  baseIndex: number,
  additions: LineAddition[],
  laterIndices: number[],
  blob: string,
  events: FileEvent[],
  runs: ScriptRun[],
  target: Path,
  records: TranscriptRecord[],
  reader: BackupReader,
  commitTimestamp: Date,
): FileEvent[] | undefined {
  const base = events[baseIndex] as FullContentEvent;
  const editedLines = applyAdditions(splitLines(base.content), additions);
  if (editedLines === undefined)
    return undefined;
  const edited = editedLines.join("\n") + "\n";
  const replayed = applyScriptRunsOver(edited, laterIndices, events, runs, target, records, reader);
  if (replayed === undefined)
    return undefined;
  if (replayed.final !== blob)
    return undefined;
  const userEdit: UserEditEvent = {
    kind: EventKind.userEdit,
    changeId: new Uuid(randomUUID()),
    target,
    content: edited,
    timestamp: computeMidpointAfter(events, baseIndex, commitTimestamp),
  };
  addStageEntry({
    stage: "placeGitCommitEvidence",
    target,
    changeId: userEdit.changeId,
    detail: "spliced a committed-blob diff as a user edit at the earliest evidence-consistent point",
    when: userEdit.timestamp,
  });
  const result: FileEvent[] = [];
  for (const [index, event] of events.entries()) {
    const rewrite = replayed.rewrites.get(index);
    result.push(rewrite === undefined ? event : { ...event, content: rewrite } as FileEvent);
  }
  result.splice(baseIndex + 1, 0, userEdit);
  return result;
}

// Place one blob's unexplained pure-addition diff onto the lineage, if possible.
export function findBlobDiffPlacement(
  blob: string,
  evidenceInstant: Date,
  events: FileEvent[],
  runs: ScriptRun[],
  target: Path,
  records: TranscriptRecord[],
  reader: BackupReader,
): FileEvent[] | undefined {
  const beforeEvidence = findFullContentIndices(events, evidenceInstant);
  if (beforeEvidence.length === 0)
    return undefined;
  const atEvidence = events[beforeEvidence[beforeEvidence.length - 1]!] as FullContentEvent;
  if (atEvidence.content === blob)
    return undefined;
  const additions = extractPureAdditions(splitLines(atEvidence.content), splitLines(blob));
  if (additions === undefined)
    return undefined;
  for (let position = 0; position < beforeEvidence.length; position += 1) {
    const placed = insertAdditionsAfter(
      beforeEvidence[position]!,
      additions,
      beforeEvidence.slice(position + 1),
      blob,
      events,
      runs,
      target,
      records,
      reader,
      evidenceInstant,
    );
    if (placed !== undefined)
      return placed;
  }
  return undefined;
}
