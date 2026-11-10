import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { writeCutTranscript } from "./engineV3_replay_plate_transcript.ts";

const CAPTURE_TIME_MS = Date.parse("2026-10-27T03:27:31.380Z");

test("test_writeCutTranscript_keeps_lines_up_to_the_capture_time_and_keeps_untimed_lines_unchanged", (t) => {
    // Scenario: lines before the capture time (and untimed lines before the first later line) stay byte for byte; the first later line and all after it go.
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-transcript-test-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    const keptLines = ['{"timestamp":"2026-10-27T03:27:31.380Z",  "a":1}', '{"type":"summary"}', '{"timestamp":"2026-10-27T03:00:00.000Z","a":2}'];
    const droppedLines = ['{"timestamp":"2026-10-27T03:27:31.381Z","a":3}', '{"type":"summary"}', '{"timestamp":"2026-10-27T03:00:00.000Z","a":4}'];
    const transcriptFile = join(folder, "agent-x.jsonl");
    writeFileSync(transcriptFile, [...keptLines, ...droppedLines].join("\n") + "\n");
    // cut it
    const cutPath = writeCutTranscript(new Path(transcriptFile), CAPTURE_TIME_MS);
    t.after(() => rmSync(join(cutPath.toString(), ".."), { recursive: true, force: true }));
    // only the kept lines remain, same file name
    assert.equal(readFileSync(cutPath.toString(), "utf8"), keptLines.join("\n"));
    assert.equal(basename(cutPath.toString()), "agent-x.jsonl");
});
