// Task 313 (spec S19): /api/layer1-file's snapshot form — one @vN's bytes from its OWNING session.

import { resolve, sep } from "node:path";
import { collectSnapshotPlacements, type SnapshotPlacement } from "./layer1_snapshots.ts";
import { collectTitleRanges, titleInEffectAtLine } from "./layer1_sessions.ts";
import { relativizeToProjectFolder } from "./layer1_snapshot_wire.ts";
import { loadTranscript } from "./parse/loadTranscript.ts";
import { createSidecarReader, resolveFileHistoryRoot } from "./reconstruction_sidecar_reader.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { requireParam } from "./viewer_server_routes.ts";

// Trust boundary: a session id reaches the filesystem as a path segment, so refuse `.`, `/`, `\`.
const SESSION_ID_PATTERN = /^[0-9a-fA-F-]+$/;

// @vN is numbered PER FILE within a session, so path — not version alone — disambiguates the blob.
function parseSnapshotVersion(raw: string): number {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 0) {
        throw new Error(`not a snapshot version: ${raw}`);
    }
    return version;
}

// The one placement matching this file + owning session + version; undefined when the session records none.
function findSnapshotPlacement(
    sessionFile: Path,
    projectFolder: Path,
    relativePath: string,
    owner: Uuid,
    version: number,
): SnapshotPlacement | undefined {
    for (const [absolutePath, placements] of collectSnapshotPlacements([sessionFile])) {
        if (relativizeToProjectFolder(projectFolder, absolutePath) !== relativePath) {
            continue;
        }
        const match = placements.find(
            (placement) => placement.sessionId.toString() === owner.toString() && placement.version === version,
        );
        if (match) {
            return match;
        }
    }
    return undefined;
}

// True when this query selects the snapshot form; the owning-session transcript path is its marker.
export function isSnapshotFileRequest(query: URLSearchParams): boolean {
    return query.get("snapshotSession") !== null;
}

// Task 317: the blob's bytes, plus the customTitle in effect at the snapshot's LINE (not first or last).
export function readSnapshotFileContent(query: URLSearchParams): { content: string; title: string } {
    const sessionId = requireParam(query, "sessionId");
    if (!SESSION_ID_PATTERN.test(sessionId)) {
        throw new Error(`not a session id: ${sessionId}`);
    }
    const owner = new Uuid(sessionId);
    const sessionFile = new Path(requireParam(query, "snapshotSession"));
    const projectFolder = new Path(requireParam(query, "dir"));
    const relativePath = requireParam(query, "path");
    const version = parseSnapshotVersion(requireParam(query, "version"));
    const placement = findSnapshotPlacement(sessionFile, projectFolder, relativePath, owner, version);
    if (placement === undefined) {
        throw new Error(`no snapshot ${relativePath}@v${version} in session ${sessionId}`);
    }
    const records = loadTranscript(sessionFile.toString(), undefined, true).records;
    const root = resolveFileHistoryRoot(records);
    // Defense in depth: the name is re-derived, but confirm the read never escapes this session's dir.
    const sessionDir = resolve(root.toString(), owner.toString());
    if (!resolve(sessionDir, placement.backupFileName.toString()).startsWith(sessionDir + sep)) {
        throw new Error(`snapshot escapes the file-history root: ${placement.backupFileName.toString()}`);
    }
    const content = createSidecarReader(owner, root)(placement.backupFileName);
    const title = titleInEffectAtLine(collectTitleRanges(records), placement.line ?? 0) ?? "untitled session";
    return { content, title };
}
