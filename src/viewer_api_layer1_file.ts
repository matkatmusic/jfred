// GET /api/layer1-file (task 257): the text of ONE file at ONE moment, for the Detail View drawer. Two forms, one per node kind Layer 1 draws — a commit node reads its blob out of git (`?repo=&path=&hash=`), the on-disk node reads the working-tree bytes (`?dir=&path=`). `path` is repo-relative in BOTH forms: it is WirePair.path, which layer1_disk_walk.ts produces relative to each root. There is no view to build here, so this file is the whole surface.
//
// Both inputs are trust boundaries and are validated as such: the hash reaches a git argument, and the path reaches the filesystem.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { Path } from "./structures/domain.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// A commit hash reaches a git argument, so it is checked here before it gets there. Declared rather than imported: viewer_api_repo.ts's identical pattern is module-private, and task 257 owns no edit to that file — exporting it from there would touch a route this task must leave alone. If it is ever exported, import it and delete this.
const COMMIT_HASH_PATTERN = /^[0-9a-fA-F]{4,40}$/;

// The committed bytes at <hash>:<path>. spawnSync in ARGUMENT-ARRAY form, never an execSync template (the task-235 rule): neither the hash nor the path may be parsed by a shell. git itself refuses a `path` that leaves the tree, so the tree read needs no traversal check of its own — the hash pattern is the boundary that matters.
function readCommittedFileContent(repoDir: Path, filePath: Path, hash: string): string {
    if (!COMMIT_HASH_PATTERN.test(hash)) {
        throw new Error(`not a commit hash: ${hash}`);
    }
    const result = spawnSync("git", ["show", `${hash}:${filePath.toString()}`], {
        cwd: repoDir.toString(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`git show failed for ${hash}:${filePath.toString()} in ${repoDir.toString()}: ${result.stderr ?? result.error?.message ?? ""}`.trim());
    }
    return result.stdout;
}

// The working-tree bytes under `dir`. A `path` that escapes the folder is refused before any read: it arrives from a URL, so "../../etc/passwd" would otherwise be served verbatim. The separator on the prefix is load-bearing — without it a sibling folder ("/tmp/ab" under "/tmp/a") passes the startsWith.
function readWorkingTreeFileContent(projectFolder: Path, filePath: Path): string {
    const folder = resolve(projectFolder.toString());
    const resolved = resolve(join(folder, filePath.toString()));
    if (!resolved.startsWith(folder + sep)) {
        throw new Error(`path escapes the folder: ${filePath.toString()}`);
    }
    return readFileSync(resolved, "utf8");
}

// An absent `hash` AND an empty one both mean the on-disk form — a blank query value must read as "no commit asked for" rather than as a malformed hash.
function readLayer1FileContent(query: URLSearchParams): string {
    const filePath = new Path(requireParam(query, "path"));
    const hash = query.get("hash");
    if (hash === null || hash.trim() === "") {
        return readWorkingTreeFileContent(new Path(requireParam(query, "dir")), filePath);
    }
    return readCommittedFileContent(new Path(requireParam(query, "repo")), filePath, hash.trim());
}

// GET /api/layer1-file?repo=&path=&hash= (a commit node) or ?dir=&path= (the on-disk node) → { content }. Every failure throws with its message and no header written, so viewer_server.ts's outer catch turns it into a 400 the drawer can display.
export function handleLayer1FileRequest(response: ServerResponse, query: URLSearchParams): void {
    sendJson(response, 200, { content: readLayer1FileContent(query) });
}
