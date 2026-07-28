// The HTTP surface of GET /api/layer1-view (task 235). The seam is one-directional: this module
// parses and frames, viewer_api_layer1.ts builds the view and knows nothing about HTTP. Importing
// the other way would be a cycle, since the stream must call the builder WITH its progress sink.

import { type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { ACTIVE_BRANCH_REF } from "./layer1_repo_tree.ts";
import { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";
import { CommitTimeSource } from "./structures/vocabulary_view.ts";
import { buildLayer1View } from "./viewer_api_layer1.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// Validated here rather than deep in a walker so a bad box is a 400 the page can display, not an
// ENOENT. No allowlist: a localhost tool reads the user's own machine (as POST /api/config does).
export function requireExistingFolderParam(query: URLSearchParams, name: string): Path {
    const value = requireParam(query, name);
    if (!existsSync(value)) {
        throw new Error(`${name} folder does not exist: ${value}`);
    }
    if (!statSync(value).isDirectory()) {
        throw new Error(`${name} is not a folder: ${value}`);
    }
    return new Path(value);
}

// An absent ref AND an empty one both mean "the repo's active branch" — the header's ref box is
// optional, and a blank box still submits `?ref=`. A non-repo repo path and an unresolvable ref
// need no check of their own: readRepoTreeAtRef throws naming the ref, and git ls-tree's stderr
// names the non-repo case. The ref never reaches a shell (both git calls use argument arrays), so
// no validation regex is required.
export function resolveRequestedRef(query: URLSearchParams): string {
    const requested = query.get("ref");
    if (requested === null) {
        return ACTIVE_BRANCH_REF;
    }
    if (requested.trim() === "") {
        return ACTIVE_BRANCH_REF;
    }
    return requested.trim();
}

// An unknown value degrades to committer rather than 400ing: the param only picks between two
// readings of the same data, so a typo must not refuse a view the user can otherwise see.
function resolveRequestedTimeSource(query: URLSearchParams): CommitTimeSource {
    return query.get("time") === CommitTimeSource.author ? CommitTimeSource.author : CommitTimeSource.committer;
}

// Same NDJSON framing as /api/document, so the page classifies lines as app-fetch.ts already does.
// The socket details below are load-bearing and are why this copies viewer_server_routes.ts rather
// than using a stream helper: the build is SYNCHRONOUS and never yields between lines.
function streamLayer1View(response: ServerResponse, projectFolder: Path, repoDir: Path, ref: string, timeSource: CommitTimeSource): void {
    response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
    response.socket?.setNoDelay(true);   // sync build between writes — do not let Nagle batch the lines
    const writeNdjsonLine = (value: unknown): void => {
        // The synchronous build never yields, so a client-abort 'close' event is never delivered
        // mid-build. Detection works anyway: the first write after the client's RST fails
        // synchronously inside net.Socket (uv_try_write EPIPE), which flips socket.writable to
        // false without needing the loop — `destroyed` stays false until the loop turns, so it is
        // the writable check that fires; the NEXT call here sees it and aborts the build.
        if (response.destroyed || response.socket === null || response.socket.destroyed || !response.socket.writable) {
            throw new Error("client disconnected — build cancelled");
        }
        response.write(JSON.stringify(value) + "\n");
        // res.write corks the socket and uncorks on nextTick — which never runs during the
        // synchronous build, so every line would sit buffered until the build ends. Uncork NOW
        // so each line flushes to the wire as it is written.
        response.socket?.uncork();
    };
    try {
        response.end(JSON.stringify(buildLayer1View(projectFolder, repoDir, ref, writeNdjsonLine, timeSource)) + "\n");
    } catch (error) {
        // ASYMMETRY, deliberate: a bad `dir`/`repo` is a 400 because it is caught before any header
        // is written, but a bad `ref` cannot be — readRepoTreeAtRef runs INSIDE the build, after
        // the header is already out. So a ref failure is a terminal error LINE instead, and the
        // page surfaces both through the same crumb.
        response.end(JSON.stringify({ kind: DocumentResponseKind.error, label: String(error) }) + "\n");
    }
}

// Both folder checks run BEFORE either path, so a bad `dir`/`repo` throws with no header written
// and viewer_server.ts's outer catch can still make it a 400 — even when a stream was asked for.
export function handleLayer1ViewRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectFolder = requireExistingFolderParam(query, "dir");
    const repoDir = requireExistingFolderParam(query, "repo");
    const ref = resolveRequestedRef(query);
    const timeSource = resolveRequestedTimeSource(query);
    if (query.get("progress") !== "1") {
        sendJson(response, 200, buildLayer1View(projectFolder, repoDir, ref, undefined, timeSource));
        return;
    }
    streamLayer1View(response, projectFolder, repoDir, ref, timeSource);
}
