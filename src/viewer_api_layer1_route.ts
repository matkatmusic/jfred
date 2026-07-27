// The HTTP surface of GET /api/layer1-view (task 235, plus the S18 feedback fixes' NDJSON stream).
// Split from viewer_api_layer1.ts when step 4a's socket handling pushed that file past the 250-line
// cap. The seam is deliberate and one-directional: THIS module parses the query, validates the two
// folders and frames the response; viewer_api_layer1.ts builds the view and owns the wire types, and
// knows nothing about HTTP. Importing the other way would be a cycle, since the stream must call the
// builder WITH its progress sink.

import { type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { ACTIVE_BRANCH_REF } from "./layer1_repo_tree.ts";
import { Path } from "./structures/domain.ts";
import { CommitTimeSource, DocumentResponseKind } from "./structures/vocabulary.ts";
import { buildLayer1View } from "./viewer_api_layer1.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// `dir` and `repo` are pasted or typed into the header's text boxes, so both are validated here
// rather than deep in a walker: a bad one must be a 400 the page can display, not an ENOENT from
// readdirSync. Existence + is-a-folder only — this is a localhost tool reading the user's own
// machine, so there is no allowlist to enforce (the same posture as POST /api/config).
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

// `time=author` selects author stamps; anything else — absent, empty, unrecognised — is committer,
// the reading the view has always used. An unknown value is not a 400: this param only chooses
// between two readings of the same data, so a typo degrades to the default rather than refusing a
// view the user can otherwise see.
function resolveRequestedTimeSource(query: URLSearchParams): CommitTimeSource {
    return query.get("time") === CommitTimeSource.author ? CommitTimeSource.author : CommitTimeSource.committer;
}

// Stream the view as NDJSON: one progress line per stage, then the finished view as the terminal
// line. Same framing as /api/document — progress and error lines carry a `kind`, the terminal
// payload has none — so the page classifies a line exactly as app-fetch.ts already does.
//
// The three socket details below are all load-bearing, and are the reason this copies
// viewer_server_routes.ts rather than reaching for a stream helper: the build is SYNCHRONOUS, so
// nothing yields to the event loop between lines.
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

// GET /api/layer1-view?dir=&repo=&ref=&progress=&time= — the S18 Layer 1 View. Without `progress=1` it is
// one JSON body (Path/Date serialize via toJSON / to ISO strings); with it, the same view arrives as
// the last line of an NDJSON progress stream. Both folder checks run BEFORE either path, so a bad
// `dir`/`repo` still throws with no header written and viewer_server.ts's outer catch turns it into
// a 400 carrying the message and no stack — even when the caller asked for a stream.
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
