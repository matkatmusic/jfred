import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOnlyKnownTopLevelKeys, reportUnmodeledTopLevelFields } from "../src/parse/unmodeledFields.ts";
import { UnmodeledFieldError } from "../src/parse/recordKeys.ts";
import { parseRecord } from "../src/parse/parseRecord.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";

const MODE_LINE = JSON.stringify({ type: "mode", sessionId: "s", mode: "normal" });
const MODE_LINE_WITH_EXTRA = JSON.stringify({ type: "mode", sessionId: "s", mode: "normal", surprise: 1 });

test("test_assertOnlyKnownTopLevelKeys_accepts_modeled_record", () => {
  assertOnlyKnownTopLevelKeys(parseRecord(MODE_LINE));
});

test("test_assertOnlyKnownTopLevelKeys_throws_on_unmodeled_key", () => {
  assert.throws(() => assertOnlyKnownTopLevelKeys(parseRecord(MODE_LINE_WITH_EXTRA)), UnmodeledFieldError);
});

test("test_reportUnmodeledTopLevelFields_reports_each_field_once", () => {
  const events: ProgressEvent[] = [];
  const onProgress = (event: ProgressEvent): void => {
    events.push(event);
  };
  const reported = new Set<string>();
  reportUnmodeledTopLevelFields(parseRecord(MODE_LINE_WITH_EXTRA), reported, onProgress);
  reportUnmodeledTopLevelFields(parseRecord(MODE_LINE_WITH_EXTRA), reported, onProgress);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.label, 'unmodeled field "surprise" on mode record');
});
