// Remembers a file's content from before a Write/Edit that the replay applied early, until that call's result line arrives.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Path } from "../src/structures/domain.ts";
import { convertEditResult, convertWriteResult } from "../src/structures/tool-result-shapes.ts";
import { JSONLLineKind, getJSONLLineKind, type JSONLLine } from "./engineV3.ts";

export const ABSENT_BEFORE_CONTENT = "absent";

export type BeforeContent = Buffer | typeof ABSENT_BEFORE_CONTENT;

type PendingWrite = { beforeContent: BeforeContent; pendingCount: number };

const pendingWritesByFile = new Map<string, PendingWrite>();

export function clearPendingWrites(): void {
  pendingWritesByFile.clear();
}

// The absolute path that the result line writes, or undefined when the line writes no file.
function findWrittenFile(state: Path, resultLine: JSONLLine): string | undefined {
  const kind = getJSONLLineKind(resultLine, state);
  switch (kind) {
    case JSONLLineKind.WriteCreate:
    case JSONLLineKind.WriteUpdate: return resolve(convertWriteResult(resultLine.toolUseResult).filePath.toString());
    case JSONLLineKind.EditWholeFile:
    case JSONLLineKind.EditPartial: return resolve(convertEditResult(resultLine.toolUseResult).filePath.toString());
    default: return undefined;
  }
}

function readBeforeContent(file: string): BeforeContent {
  const fileExists = existsSync(file);
  if (!fileExists) {
    return ABSENT_BEFORE_CONTENT;
  }
  return readFileSync(file);
}

// The file text that the result line says was on disk before the write, or null when the result has none.
function findResultOriginalFile(state: Path, resultLine: JSONLLine): string | null {
  const kind = getJSONLLineKind(resultLine, state);
  switch (kind) {
    case JSONLLineKind.WriteCreate:
    case JSONLLineKind.WriteUpdate: return convertWriteResult(resultLine.toolUseResult).originalFile;
    case JSONLLineKind.EditWholeFile:
    case JSONLLineKind.EditPartial: return convertEditResult(resultLine.toolUseResult).originalFile;
    default: return null;
  }
}

// The originalFile is the real disk text, and it includes user edits that the replay never saw.
function findBeforeContent(state: Path, resultLine: JSONLLine, file: string): BeforeContent {
  const originalFile = findResultOriginalFile(state, resultLine);
  if (originalFile === null) {
    return readBeforeContent(file);
  }
  return Buffer.from(originalFile, "utf8");
}

// Call this just before the result line is applied early. A second pending write to the same file keeps the first before-content.
export function addPendingWrite(state: Path, resultLine: JSONLLine): void {
  const file = findWrittenFile(state, resultLine);
  if (file === undefined) {
    return;
  }
  const pendingWrite = pendingWritesByFile.get(file);
  if (pendingWrite === undefined) {
    pendingWritesByFile.set(file, { beforeContent: findBeforeContent(state, resultLine, file), pendingCount: 1 });
    return;
  }
  pendingWrite.pendingCount += 1;
}

// Call this when the result line itself is reached. The record goes away with the last pending write of the file.
export function removePendingWrite(state: Path, resultLine: JSONLLine): void {
  const file = findWrittenFile(state, resultLine);
  if (file === undefined) {
    return;
  }
  const pendingWrite = pendingWritesByFile.get(file);
  if (pendingWrite === undefined) {
    return;
  }
  pendingWrite.pendingCount -= 1;
  if (pendingWrite.pendingCount === 0) {
    pendingWritesByFile.delete(file);
  }
}

export function findPendingBeforeContent(absoluteFile: string): BeforeContent | undefined {
  return pendingWritesByFile.get(absoluteFile)?.beforeContent;
}
