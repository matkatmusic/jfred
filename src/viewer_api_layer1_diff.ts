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

// Identical sides emit no git hunk, so full context synthesizes one: the whole file as context lines.
function buildAllContextHunk(lines: string[]): string {
    if (lines.length === 0) {
        return "";
    }
    return [`@@ -1,${lines.length} +1,${lines.length} @@`, ...lines.map((line) => ` ${line}`)].join("\n");
}

// Answers { diff }; empty when identical (unless context=full), failures 400 via the server's catch.
export function handleLayer1DiffRequest(response: ServerResponse, query: URLSearchParams): void {
    const baseLines = splitContentLines(readLayer1FileBytes(query, "baseHash"));
    const targetLines = splitContentLines(readLayer1FileBytes(query, "targetHash"));
    // Task 320: the drawer's full-content toggle widens the diff to the whole file.
    const wantsFullContext = query.get("context") === "full";
    const diff = runGitUnifiedDiff(baseLines, targetLines, wantsFullContext ? FULL_FILE_CONTEXT_LINES : undefined);
    sendJson(response, 200, { diff: diff === "" && wantsFullContext ? buildAllContextHunk(targetLines) : diff });
}
