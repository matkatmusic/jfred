// Loads the records of one transcript file, in file order, including lines of unknown record types.

import { readFileSync } from "node:fs";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource, loadTranscript, setRecordSource, type RecordSource, type SkippedLine } from "../src/parse/loadTranscript.ts";
import { findUnmodeledTopLevelKeys } from "../src/parse/recordKeys.ts";
import type { JSONLLine } from "./engineV3.ts";

export type UnknownField = { recordType: string; fieldName: string };

// Each (record type, field) pair is added once.
function collectUnknownFields(records: JSONLLine[], seenFieldIds: Set<string>, unknownFields: UnknownField[]): void {
  for (const record of records) {
    for (const fieldName of findUnmodeledTopLevelKeys(record)) {
      const fieldId = `${record.type}.${fieldName}`;
      const isNewField = !seenFieldIds.has(fieldId);
      if (isNewField) {
        seenFieldIds.add(fieldId);
        unknownFields.push({ recordType: record.type, fieldName });
      }
    }
  }
}

const UNKNOWN_TYPE_REASON_PREFIX = "Unknown transcript record type";

// Any skipped line except an unknown record type stops the run.
function assertOnlyUnknownTypesSkipped(transcriptFile: Path, skippedLines: SkippedLine[], fileLines: string[]): void {
  for (const skippedLine of skippedLines) {
    const isUnknownType = skippedLine.reason.startsWith(UNKNOWN_TYPE_REASON_PREFIX);
    if (!isUnknownType) {
      const skippedText = (fileLines[skippedLine.lineNumber - 1] as string).slice(0, 200);
      throw new Error(`${transcriptFile.toString()}:${skippedLine.lineNumber} skipped (${skippedLine.reason}): ${skippedText}`);
    }
  }
}

// The loader rejects the line's type, so this parses the raw text without that check.
export function parseUnknownTypeLine(text: string): JSONLLine {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.timestamp === "string") {
    parsed.timestamp = new Date(parsed.timestamp);
  }
  return parsed as JSONLLine;
}

function createRecordsByLineNumber(transcriptFile: Path, records: JSONLLine[], skippedLines: SkippedLine[], fileLines: string[], unknownRecordTypes: Set<string>): Map<number, JSONLLine> {
  const byLineNumber = new Map<number, JSONLLine>();
  for (const record of records) {
    byLineNumber.set((getRecordSource(record) as RecordSource).lineNumber, record);
  }
  for (const skippedLine of skippedLines) {
    const record = parseUnknownTypeLine(fileLines[skippedLine.lineNumber - 1] as string);
    setRecordSource(record, { filePath: transcriptFile.toString(), lineNumber: skippedLine.lineNumber });
    unknownRecordTypes.add(String(record.type));
    byLineNumber.set(skippedLine.lineNumber, record);
  }
  return byLineNumber;
}

function listRecordsInFileOrder(byLineNumber: Map<number, JSONLLine>, lineCount: number): JSONLLine[] {
  const ordered: JSONLLine[] = [];
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    const record = byLineNumber.get(lineNumber);
    if (record !== undefined) {
      ordered.push(record);
    }
  }
  return ordered;
}

export function loadFileRecords(transcriptFile: Path, seenFieldIds: Set<string>, unknownFields: UnknownField[], unknownRecordTypes: Set<string>): JSONLLine[] {
  const { records, skippedLines } = loadTranscript(transcriptFile.toString(), undefined, true);
  const fileLines = readFileSync(transcriptFile.toString(), "utf8").split("\n");
  assertOnlyUnknownTypesSkipped(transcriptFile, skippedLines, fileLines);
  collectUnknownFields(records, seenFieldIds, unknownFields);
  const byLineNumber = createRecordsByLineNumber(transcriptFile, records, skippedLines, fileLines, unknownRecordTypes);
  return listRecordsInFileOrder(byLineNumber, fileLines.length);
}
