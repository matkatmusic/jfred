// Debug viewer route (task 183): GET /api/file-ladder serves one file's revision ladder or the list of final paths.

import { type ServerResponse } from "node:http";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { mergeMultiSourceRecords, splitRecordsBySession } from "./reconstruction_multi_source.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { selectLiveBranch } from "./reconstruction_branch.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { buildRenameChain, collectDistinctFinalPaths } from "./reconstruction_lineage.ts";
import { getSurvivingFileHistory } from "./reconstruction_target.ts";
import { applyProjectOverrides } from "./viewer_api_projects.ts";
import { findJsonlPaths } from "./viewer_api_sources.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// Merged multi-source records plus sidecar reader, as buildProjectReconstruction composes them, minus the engine build.
function loadMergedProjectRecords(projectName: string): { records: TranscriptRecord[]; reader: BackupReader | undefined } {
  applyProjectOverrides(projectName);
  const { records } = loadProjectRecords(findJsonlPaths(projectName, null));
  const sources = getPathOverrides().sources;
  const merged = sources === undefined || sources.length === 0
    ? records
    : mergeMultiSourceRecords(splitRecordsBySession(records), sources);
  return { records: merged, reader: buildSidecarReader(merged, sources) };
}

// ponytail: script-born paths are absent from this list; a deep-linked ladder request still finds them.
function listFinalPaths(records: TranscriptRecord[]): string[] {
  const events = extractFileEvents(selectLiveBranch(records));
  const renameChain = buildRenameChain(events);
  const finalPaths = collectDistinctFinalPaths(events, renameChain);
  const pathStrings: string[] = [];
  for (const path of finalPaths)
    pathStrings.push(path.toString());
  return pathStrings.sort();
}

// GET /api/file-ladder?project=NAME[&file=PATH]: without file, the final paths; with file, its FileHistory. Unknown file throws.
export function sendFileLadder(response: ServerResponse, query: URLSearchParams): void {
  const projectName = getRequiredParam(query, "project");
  const fileValue = query.get("file");
  const { records, reader } = loadMergedProjectRecords(projectName);
  if (fileValue === null) {
    sendJson(response, 200, { files: listFinalPaths(records) });
    return;
  }
  const history = getSurvivingFileHistory(records, new Path(fileValue), reader);
  if (history === undefined) {
    throw new Error(`no revision ladder for ${fileValue} — not a reconstructable final path`);
  }
  sendJson(response, 200, history);
}
