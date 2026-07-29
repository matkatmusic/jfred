// The per-file DEBUG viewer's server surface (task 183): GET /api/file-ladder serves one file's revision ladder from the merged multi-source reconstruction — the proven surviving-branch fast path (task 182/192) — and, without a file param, the list of final paths to pick from. A debug surface: engine internals (kind, changeId, unrecoverable notes) ride the wire by design. HTTP wiring stays in viewer_server.ts (precedent: viewer_api_layered.ts).

import { type ServerResponse } from "node:http";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { mergeMultiSourceRecords, groupRecordsBySession } from "./reconstruction_multi_source.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { selectLiveBranch } from "./reconstruction_branch.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { buildRenameChain, distinctFinalPaths } from "./reconstruction_lineage.ts";
import { reconstructSurvivingFileHistory } from "./reconstruction_target.ts";
import { applyProjectOverrides } from "./viewer_api_projects.ts";
import { resolveJsonlPaths } from "./viewer_api_sources.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// The project's merged multi-source record stream plus its sidecar reader — the same composition buildProjectReconstruction uses (viewer_api.ts), minus the engine build.
function prepareMergedProjectRecords(projectName: string): { records: TranscriptRecord[]; reader: BackupReader | undefined } {
    applyProjectOverrides(projectName);
    const { records } = loadProjectRecords(resolveJsonlPaths(projectName, null));
    const sources = getPathOverrides().sources;
    const merged = sources === undefined || sources.length === 0
        ? records
        : mergeMultiSourceRecords(groupRecordsBySession(records), sources);
    return { records: merged, reader: buildSidecarReader(merged, sources) };
}

// The final paths a ladder request can target, from the surviving records' rename lineage.
// ponytail: script-born paths only a sandbox run discovers are absent from this LIST; a deep-linked ladder request still finds them (the fast path appends script moves itself).
function listFinalPaths(records: TranscriptRecord[]): string[] {
    const events = extractFileEvents(selectLiveBranch(records));
    const renameChain = buildRenameChain(events);
    return distinctFinalPaths(events, renameChain)
        .map((path) => path.toString())
        .sort();
}

// GET /api/file-ladder?project=<name>[&file=<path>] — without file, { files }: the pickable final paths; with file, that file's FileHistory (JSON-clean: Path/Uuid via toJSON, Dates to ISO strings). An unknown file throws into the server's outer catch (400), the same refusal posture as every other trust-boundary route.
export function handleFileLadderRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectName = requireParam(query, "project");
    const fileValue = query.get("file");
    const { records, reader } = prepareMergedProjectRecords(projectName);
    if (fileValue === null) {
        sendJson(response, 200, { files: listFinalPaths(records) });
        return;
    }
    const history = reconstructSurvivingFileHistory(records, new Path(fileValue), reader);
    if (history === undefined) {
        throw new Error(`no revision ladder for ${fileValue} — not a reconstructable final path`);
    }
    sendJson(response, 200, history);
}
