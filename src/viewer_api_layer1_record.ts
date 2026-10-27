// GET /api/layer1-record: one parsed JSONL line by session file and 1-based line number.

import { readFileSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { Path } from "./structures/domain.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

export function readTranscriptLine(sessionFile: Path, lineNumber: number): unknown {
  if (!sessionFile.toString().endsWith(".jsonl")) {
    throw new Error(`not a transcript file: ${sessionFile.toString()}`);
  }
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error(`not a line number: ${lineNumber}`);
  }
  const text = readFileSync(sessionFile.toString(), "utf8").split("\n")[lineNumber - 1];
  if (text === undefined || text === "") {
    throw new Error(`no record at line ${lineNumber} of ${sessionFile.toString()}`);
  }
  return JSON.parse(text);
}

export function handleLayer1RecordRequest(response: ServerResponse, query: URLSearchParams): void {
  sendJson(response, 200, readTranscriptLine(new Path(requireParam(query, "jsonl")), Number(requireParam(query, "line"))));
}
