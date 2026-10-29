// GET /api/layer1-diff: unified-diff hunks between two revisions of one Layer 1 file.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { FULL_FILE_CONTEXT_LINES, runGitUnifiedDiff } from "./render_git_diff.ts";
import { readLayer1FileBytes } from "./viewer_api_layer1_file.ts";
import { readSnapshotFileContent } from "./viewer_api_layer1_snapshot.ts";
import { sendJson } from "./viewer_server_routes.ts";

// Text → lines for git's side files; a trailing newline's empty element is not a line.
function splitContentLines(text: string): string[] {
  const lines = text.split("\n");
  const lastLine = lines.at(-1);
  const hasTrailingNewline = lastLine === "";
  if (hasTrailingNewline) {
    lines.pop();
  }
  return lines;
}

// One side's lines: a snapshot's sidecar blob (task 329), a commit blob, or the working tree.
function readSideLines(query: URLSearchParams, side: "base" | "target"): string[] {
  const snapshotSession = query.get(`${side}SnapshotSession`);
  if (snapshotSession !== null) {
    const sideQuery = new URLSearchParams({
      snapshotSession,
      sessionId: query.get(`${side}SessionId`) ?? "",
      version: query.get(`${side}Version`) ?? "",
      path: query.get("path") ?? "",
      dir: query.get("dir") ?? "",
    });
    return splitContentLines(readSnapshotFileContent(sideQuery).content);
  }
  return splitContentLines(readLayer1FileBytes(query, `${side}Hash`).toString("utf8"));
}

// Identical sides emit no git hunk, so full context synthesizes one: the whole file as context lines.
function buildAllContextHunk(lines: string[]): string {
  if (lines.length === 0) {
    return "";
  }
  const contextLines: string[] = [];
  for (const line of lines) {
    contextLines.push(` ${line}`);
  }
  return [`@@ -1,${lines.length} +1,${lines.length} @@`, ...contextLines].join("\n");
}

// The diff string between two revisions; task 330's fixture route feeds canned lines through the same rule.
export function buildLayer1DiffPayload(baseLines: string[], targetLines: string[], wantsFullContext: boolean): string {
  const diff = runGitUnifiedDiff(baseLines, targetLines, wantsFullContext ? FULL_FILE_CONTEXT_LINES : undefined);
  // Task 320: the drawer's full-content toggle widens an identical-sides diff to the whole file.
  return diff === "" && wantsFullContext ? buildAllContextHunk(targetLines) : diff;
}

// Answers { diff }; empty when identical (unless context=full), failures 400 via the server's catch.
export function sendLayer1Diff(response: ServerResponse, query: URLSearchParams): void {
  const baseLines = readSideLines(query, "base");
  const targetLines = readSideLines(query, "target");
  sendJson(response, 200, { diff: buildLayer1DiffPayload(baseLines, targetLines, query.get("context") === "full") });
}

// POST /api/layer1-diff-content (task 329): { base, target, context? } strings in, { diff } out.
export function sendLayer1DiffContent(request: IncomingMessage, response: ServerResponse): void {
  let body = "";
  function appendChunk(chunk: Buffer): void {
    body += chunk.toString();
  }
  function sendDiffForBody(): void {
    try {
      const payload = JSON.parse(body) as { base: string; target: string; context?: string };
      sendJson(response, 200, {
        diff: buildLayer1DiffPayload(
          splitContentLines(payload.base), splitContentLines(payload.target), payload.context === "full"),
      });
    }
    catch (error) {
      sendJson(response, 400, { error: String(error) });
    }
  }
  request.on("data", appendChunk);
  request.on("end", sendDiffForBody);
}
