import { RecordType, EventKind } from "../src/structures/vocabulary.ts";

// Git-baseline document: one turn pair, a gitBase step, and an unattributed step.
export const gitBaselineDocument = {
  messages: [{
    uuid: "prompt-1",
    role: RecordType.user,
    sessionId: "session-a",
    timestamp: "2026-01-01T00:10:00.000Z",
    text: "start working",
  }, {
    uuid: "reply-1",
    role: RecordType.assistant,
    sessionId: "session-a",
    timestamp: "2026-01-01T00:10:10.000Z",
    text: "working",
  }],
  steps: [
    { index: 1, when: "2026-01-01T00:00:00.000Z", sessionId: undefined, changeIds: ["gitBase:abc1234:orders.py"], changedPaths: [], files: {} },
    { index: 2, when: "2026-01-01T00:20:00.000Z", sessionId: undefined, changeIds: ["deadbeef00000000@v1"], changedPaths: ["notes.txt"], files: {} },
  ],
  filesTouched: [{
    target: "orders.py",
    revisions: [{ kind: EventKind.write, changeId: "gitBase:abc1234:orders.py", timestamp: "2026-01-01T00:00:00.000Z" }],
  }],
  rewoundFilesTouched: [],
  commitMarkers: [],
  gitOperations: [],
};
