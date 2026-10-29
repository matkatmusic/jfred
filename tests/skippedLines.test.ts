import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSkippedLine, collectSkippedLineOrRethrow } from "../src/parse/skippedLines.ts";
import { parseRecord } from "../src/parse/parseRecord.ts";
import type { ProgressEvent, SkippedLine } from "../src/parse/loadTranscript.ts";

const UNKNOWN_TYPE_LINE = JSON.stringify({ type: "future-nonsense", timestamp: "2026-01-01T00:00:00Z" });

function captureError(text: string): unknown {
  try {
    parseRecord(text);
  }
  catch (error) {
    return error;
  }
  throw new Error("expected parseRecord to throw");
}

test("test_buildSkippedLine_keeps_timestamp_for_unknown_type", () => {
  const skipped = buildSkippedLine("/a/b.jsonl", 3, UNKNOWN_TYPE_LINE, captureError(UNKNOWN_TYPE_LINE));
  assert.equal(skipped.lineNumber, 3);
  assert.equal(skipped.timestamp?.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(String(skipped.filePath), "/a/b.jsonl");
});

test("test_buildSkippedLine_labels_malformed_json_without_timestamp", () => {
  const skipped = buildSkippedLine("/a/b.jsonl", 4, "{oops", captureError("{oops"));
  assert.equal(skipped.timestamp, undefined);
  assert.match(skipped.reason, /^malformed JSON: /);
});

test("test_collectSkippedLineOrRethrow_rethrows_in_strict_mode", () => {
  const boom = new Error("boom");
  const skippedLines: SkippedLine[] = [];
  assert.throws(
    () => collectSkippedLineOrRethrow(boom, false, { filePath: "/a/b.jsonl", lineNumber: 1 }, "x", skippedLines, undefined),
    boom,
  );
  assert.equal(skippedLines.length, 0);
});

test("test_collectSkippedLineOrRethrow_collects_and_reports_in_tolerant_mode", () => {
  const skippedLines: SkippedLine[] = [];
  const events: ProgressEvent[] = [];
  const onProgress = (event: ProgressEvent): void => {
    events.push(event);
  };
  collectSkippedLineOrRethrow(new Error("boom"), true, { filePath: "/a/b.jsonl", lineNumber: 7 }, "x", skippedLines, onProgress);
  assert.equal(skippedLines.length, 1);
  assert.equal(events[0]?.label, "skipped line 7: Error: boom");
});
