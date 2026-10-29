// GET /api/layer1-record: one parsed JSONL line by session file and 1-based line number.

import { readFileSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { Path } from "./structures/domain.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

export function readTranscriptLine(sessionFile: Path, lineNumber: number): unknown {
  const sessionPath = sessionFile.toString();
  const endsWithJsonl = sessionPath.endsWith(".jsonl");
  if (!endsWithJsonl) {
    throw new Error(`not a transcript file: ${sessionPath}`);
  }
  const isInteger = Number.isInteger(lineNumber);
  const isBelowOne = lineNumber < 1;
  const isInvalidLineNumber = !isInteger || isBelowOne;
  if (isInvalidLineNumber) {
    throw new Error(`not a line number: ${lineNumber}`);
  }
  const text = readFileSync(sessionPath, "utf8").split("\n")[lineNumber - 1];
  const isMissing = text === undefined;
  const isBlank = text === "";
  const hasNoRecord = isMissing || isBlank;
  if (hasNoRecord) {
    throw new Error(`no record at line ${lineNumber} of ${sessionPath}`);
  }
  return JSON.parse(text);
}

export function sendLayer1Record(response: ServerResponse, query: URLSearchParams): void {
  sendJson(response, 200, readTranscriptLine(new Path(getRequiredParam(query, "jsonl")), Number(getRequiredParam(query, "line"))));
}
