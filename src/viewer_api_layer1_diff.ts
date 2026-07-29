// GET /api/layer1-diff (task 305): unified-diff hunks between two revisions of ONE Layer 1 file.
//
// `baseHash`/`targetHash` pick commit blobs from `repo`; an absent hash means the working tree under `dir`.

import { type ServerResponse } from "node:http";
import { FULL_FILE_CONTEXT_LINES, runGitUnifiedDiff } from "./render_git_diff.ts";
import { readLayer1FileBytes } from "./viewer_api_layer1_file.ts";
import { sendJson } from "./viewer_server_routes.ts";

// Bytes → lines for git's side files; a trailing newline's empty element is not a line.
function splitContentLines(bytes: Buffer): string[] {
    const lines = bytes.toString("utf8").split("\n");
    if (lines.at(-1) === "") {
        lines.pop();
    }
    return lines;
}

// Answers { diff }; empty when identical, failures 400 via the server's catch.
export function handleLayer1DiffRequest(response: ServerResponse, query: URLSearchParams): void {
    const baseLines = splitContentLines(readLayer1FileBytes(query, "baseHash"));
    const targetLines = splitContentLines(readLayer1FileBytes(query, "targetHash"));
    // Task 320: the drawer's full-content toggle widens the diff to the whole file.
    const contextLines = query.get("context") === "full" ? FULL_FILE_CONTEXT_LINES : undefined;
    sendJson(response, 200, { diff: runGitUnifiedDiff(baseLines, targetLines, contextLines) });
}
