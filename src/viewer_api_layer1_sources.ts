// GET /api/scan-source?path=&kind= — "does this folder hold any of what the picker is about to add?" (task 296) — plus the recursive walker /api/layer1-sessions reads its JSONL list from.
//
// The two live together because the scan IS the walk stopped at the first hit: the picker only needs to refuse an EMPTY folder, so a 12,000-file snapshot store must never be enumerated to answer it.

import { readdirSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import { SourceKind } from "./structures/vocabulary_view.ts";
import { requireExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// A file-history store names its snapshots by hash, with no common extension — so "every regular file" IS the file-history match, and only the JSONL kind narrows by name.
function matchesSourceKind(name: string, kind: SourceKind): boolean {
    if (kind === SourceKind.jsonl) {
        return name.endsWith(".jsonl");
    }
    return true;
}

// Every matching file under `root` at ANY depth, up to `limit`. Symlinked folders are not followed: a store reachable through two names would be counted twice, and a cycle would never terminate.
export function listSourceFilesUnder(root: Path, kind: SourceKind, limit = Number.MAX_SAFE_INTEGER): Path[] {
    const found: Path[] = [];
    const pending: string[] = [root.toString()];
    while (pending.length > 0 && found.length < limit) {
        const folder = pending.pop()!;
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                pending.push(join(folder, entry.name));
                continue;
            }
            if (entry.isFile() && matchesSourceKind(entry.name, kind)) {
                found.push(new Path(join(folder, entry.name)));
                if (found.length >= limit) {
                    break;
                }
            }
        }
    }
    return found;
}

export function countSourceFilesUnder(root: Path, kind: SourceKind, limit: number): number {
    return listSourceFilesUnder(root, kind, limit).length;
}

// `kind` arrives from a URL, so an unknown spelling is a 400 naming it rather than a silent fall-through to "count everything" (coding-requirements §4: compare enum members).
function requireSourceKind(query: URLSearchParams): SourceKind {
    const value = requireParam(query, "kind");
    if (value === SourceKind.jsonl) {
        return SourceKind.jsonl;
    }
    if (value === SourceKind.fileHistory) {
        return SourceKind.fileHistory;
    }
    throw new Error(`unknown source kind: ${value}`);
}

// GET /api/scan-source — { found }, capped at 1: the client's only question is "is this folder empty of what I want", and it branches on `found === 0`. A missing or unreadable `path` throws and viewer_server.ts's outer catch turns it into a 400 carrying the message, the same refusal shape every other Layer 1 route gives a bad folder.
export function handleScanSourceRequest(response: ServerResponse, query: URLSearchParams): void {
    const root = requireExistingFolderParam(query, "path");
    sendJson(response, 200, { found: countSourceFilesUnder(root, requireSourceKind(query), 1) });
}
