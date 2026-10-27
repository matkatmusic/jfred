// Task 355 step 6: /api/layer1-file's Edit form: one Edit/Write/Read node's base or target bytes, replayed from its path's events.

import { WireEditSide } from "../webapp/layer1-wire-edits.ts";
import { readBranchRevisionSide } from "./layer1_branch_revision.ts";
import { computePathReplay } from "./layer1_edit_replay.ts";
import { collectViewEditEventsByRelativePath, readBackupSeedLines } from "./layer1_edits_wire.ts";
import { collectTitleRanges, titleInEffectAtLine } from "./layer1_sessions.ts";
import { getRecordSource, loadTranscript } from "./parse/loadTranscript.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { getRequiredParam } from "./viewer_server_routes.ts";

// True when this query selects the Edit form; the tool_use id is its marker.
export function isEditFileRequest(query: URLSearchParams): boolean {
  return query.get("editChangeId") !== null;
}

export function readEditFileContent(query: URLSearchParams): { content: string; title?: string; record?: TranscriptRecord } {
  const changeId = getRequiredParam(query, "editChangeId");
  const side = getRequiredParam(query, "side");
  if (side !== WireEditSide.base && side !== WireEditSide.target) {
    throw new Error(`side must be base or target, got ${side}`);
  }
  const relativePath = getRequiredParam(query, "path");
  const projectFolder = new Path(getRequiredParam(query, "dir"));
  // Task 357: a lane node reads the disk timeline the lanes came from, not the trunk replay.
  if (query.get("branch") === "1") {
    return { content: readBranchRevisionSide(projectFolder, listTranscriptFiles(query.getAll("jsonl")), relativePath, changeId, side) };
  }
  const events = collectViewEditEventsByRelativePath(projectFolder, listTranscriptFiles(query.getAll("jsonl"))).get(relativePath) ?? [];
  const event = events.find((candidate) => candidate.changeId.toString() === changeId);
  if (event === undefined) {
    throw new Error(`no edit event ${changeId} for ${relativePath}`);
  }
  const node = computePathReplay(events, readBackupSeedLines).get(changeId)!;
  const records = loadTranscript(event.sessionFile.toString(), undefined, true).records;
  return {
    content: (side === WireEditSide.base ? node.base : node.target).join("\n"),
    title: titleInEffectAtLine(collectTitleRanges(records), event.line ?? 0) ?? "untitled session",
    record: records.find((entry) => getRecordSource(entry)?.lineNumber === event.line),
  };
}
