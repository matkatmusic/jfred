// GET /api/layer1-file: commit `?repo&path&hash` (257), on-disk `?dir&path`, snapshot `?snapshotSession&sessionId&version&path&dir` (313).
//
// Task 299: `&binary=1` answers raw bytes with an image content-type; the default stays `{ content }` as UTF-8.
//
// Both inputs are trust boundaries: the hash reaches a git argument, the path reaches the filesystem.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { Path } from "./structures/domain.ts";
import { isSnapshotFileRequest, readSnapshotFileContent } from "./viewer_api_layer1_snapshot.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// Checked before the hash reaches git; delete if viewer_api_repo.ts ever exports its identical pattern.
const COMMIT_HASH_PATTERN = /^[0-9a-fA-F]{4,40}$/;

// The image content-types the drawer renders as pictures (task 299); anything else served raw is octet-stream.
const IMAGE_CONTENT_TYPES: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
};

function resolveContentType(filePath: Path): string {
    const extension = filePath.toString().split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_CONTENT_TYPES[extension] ?? "application/octet-stream";
}

// Committed bytes at <hash>:<path> via argument-array spawnSync (task-235 rule); the hash pattern is the boundary.
export function readCommittedFileBytes(repoDir: Path, filePath: Path, hash: string): Buffer {
    if (!COMMIT_HASH_PATTERN.test(hash)) {
        throw new Error(`not a commit hash: ${hash}`);
    }
    const result = spawnSync("git", ["show", `${hash}:${filePath.toString()}`], {
        cwd: repoDir.toString(),
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`git show failed for ${hash}:${filePath.toString()} in ${repoDir.toString()}: ${result.stderr?.toString() ?? result.error?.message ?? ""}`.trim());
    }
    return result.stdout;
}

// Working-tree bytes under `dir`; a URL path that escapes the folder is refused, separator-suffixed so siblings fail too.
export function readWorkingTreeFileBytes(projectFolder: Path, filePath: Path): Buffer {
    const folder = resolve(projectFolder.toString());
    const resolved = resolve(join(folder, filePath.toString()));
    if (!resolved.startsWith(folder + sep)) {
        throw new Error(`path escapes the folder: ${filePath.toString()}`);
    }
    return readFileSync(resolved);
}

// An absent or blank hash param means the on-disk form, never a malformed hash.
export function readLayer1FileBytes(query: URLSearchParams, hashParam: string = "hash"): Buffer {
    const filePath = new Path(requireParam(query, "path"));
    const hash = query.get(hashParam);
    if (hash === null || hash.trim() === "") {
        return readWorkingTreeFileBytes(new Path(requireParam(query, "dir")), filePath);
    }
    return readCommittedFileBytes(new Path(requireParam(query, "repo")), filePath, hash.trim());
}

// Answers `{ content }`, or raw bytes when `binary=1`; failures throw so the server's outer catch 400s them.
export function handleLayer1FileRequest(response: ServerResponse, query: URLSearchParams): void {
    // Task 313: the snapshot form serves text from the owning session's sidecar, never a git/disk read.
    if (isSnapshotFileRequest(query)) {
        sendJson(response, 200, { content: readSnapshotFileContent(query) });
        return;
    }
    const bytes = readLayer1FileBytes(query);
    if (query.get("binary") === "1") {
        response.writeHead(200, { "Content-Type": resolveContentType(new Path(requireParam(query, "path"))) });
        response.end(bytes);
        return;
    }
    sendJson(response, 200, { content: bytes.toString("utf8") });
}
