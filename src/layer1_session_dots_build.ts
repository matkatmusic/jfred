// One log's records become session dots, in file order, with titles, ids and stampless borrowing.

import { basename } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Instant } from "./layered_types.ts";
import { getRecordSource } from "./parse/loadTranscript.ts";
import { collectTitleRanges, findTitleAtLine, type SessionTitleRange } from "./layer1_sessions.ts";
import { findSessionId } from "./reconstruction_sidecar_reader.ts";
import { readRecordDotDescription, type RecordDotDescription } from "./layer1_session_dot_describe.ts";
import type { Layer1WireAnnotation } from "./layer1_session_dots_types.ts";

type FileDotContext = { titles: SessionTitleRange[]; fileSessionId: Uuid };

// Claude names a main log by its session id.
function readFileSessionId(records: TranscriptRecord[], file: Path): Uuid {
  return findSessionId(records) ?? new Uuid(basename(file.toString(), ".jsonl"));
}

function addOptionalDotFields(dot: Layer1WireAnnotation, description: RecordDotDescription, record: TranscriptRecord): void {
  if (description.pairId !== undefined) {
    dot.pairId = description.pairId;
  }
  if (record.timestamp === undefined) {
    dot.isStampless = true;
  }
}

function buildDot(record: TranscriptRecord, file: Path, instant: Instant, context: FileDotContext): Layer1WireAnnotation {
  const line = getRecordSource(record)!.lineNumber;
  const description = readRecordDotDescription(record);
  const dot: Layer1WireAnnotation = {
    id: record.uuid ?? new Uuid(`${file.toString()}:${line}`),
    kind: description.kind,
    instant,
    label: description.label,
    sessionId: record.sessionId ?? context.fileSessionId,
    sessionTitle: findTitleAtLine(context.titles, line) ?? "",
    sessionFile: file.toString(),
    line,
  };
  addOptionalDotFields(dot, description, record);
  return dot;
}

// One dot per record, in file order. A stampless record borrows the previous stamped instant.
export function buildFileSessionDots(records: TranscriptRecord[], file: Path): Layer1WireAnnotation[] {
  const context = { titles: collectTitleRanges(records), fileSessionId: readFileSessionId(records, file) };
  const dots: Layer1WireAnnotation[] = [];
  let previousInstant: Instant | undefined = undefined;
  for (const record of records) {
    // const instant = record.timestamp ?? previousInstant;
    const instant: Instant | undefined = record.timestamp ?? previousInstant;
    if (instant === undefined) {
      continue;
    }
    previousInstant = instant;
    dots.push(buildDot(record, file, instant, context));
  }
  return dots;
}
