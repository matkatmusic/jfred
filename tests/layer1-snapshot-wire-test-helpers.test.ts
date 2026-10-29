// The snapshot wire fixtures build session cwd records, snapshot records, and transcripts on disk.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { RecordType } from "../src/structures/vocabulary.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import {
  SESSION_ONE,
  buildSessionCwdRecord,
  buildSnapshotRecord,
  writeFixtureSessions,
  writeSessionTranscript,
} from "./layer1-snapshot-wire-test-helpers.ts";

describe("layer1 snapshot wire fixtures", () => {
  it("builds a user record carrying the cwd and session id", () => {
    assert.deepEqual(buildSessionCwdRecord("/work", SESSION_ONE), {
      type: RecordType.user,
      cwd: "/work",
      sessionId: SESSION_ONE,
      message: { role: "user", content: "hi" },
    });
  });

  it("builds a file-history snapshot record for one tracked file", () => {
    const record = buildSnapshotRecord("a.txt", "abc@v1", 1, "2026-07-01T16:00:00.000Z");
    assert.deepEqual(record, {
      type: RecordType.fileHistorySnapshot,
      messageId: "m-a.txt-2026-07-01T16:00:00.000Z",
      isSnapshotUpdate: false,
      snapshot: {
        messageId: "m-a.txt-2026-07-01T16:00:00.000Z",
        timestamp: "2026-07-01T16:00:00.000Z",
        trackedFileBackups: { "a.txt": { backupFileName: "abc@v1", version: 1, backupTime: "2026-07-01T16:00:00.000Z" } },
      },
    });
  });

  it("writes one JSON line per record and returns the transcript path", () => {
    const transcript = writeSessionTranscript(createTempDir(), SESSION_ONE, [{ a: 1 }, { b: 2 }]);
    assert.equal(readFileSync(transcript.toString(), "utf8"), '{"a":1}\n{"b":2}\n');
  });

  it("writes one fixture session with a cwd record and three snapshots", () => {
    const sessions = writeFixtureSessions("/disk");
    assert.equal(sessions.length, 1);
    for (const session of sessions) {
      const lines = readFileSync(session.toString(), "utf8").trimEnd().split("\n");
      assert.equal(lines.length, 4);
    }
  });
});
