// task 193: shared three-turn fixture for the bound tests.

import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import {
  SESSION_A,
  buildEditRecordPair,
  buildPromptRecord,
  buildWriteRecordPair,
  makeSourceTree,
  writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

export type BoundFixture = { records: TranscriptRecord[]; alphaPath: Path };

// Three-turn fixture; withSidechainPrompt adds a subagent prompt inside turn 1.
export function createBoundFixture(options: { withFinalPrompt: boolean; withSidechainPrompt: boolean }): BoundFixture {
  const tree = makeSourceTree("-bound-project");
  const root = join(tree.treeRoot, "workspace");
  const alphaPath = join(root, "alpha_bound.py");
  const betaPath = join(root, "beta_bound.py");
  const writeAlpha = buildWriteRecordPair(
    { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:01:00.000Z", toolId: "toolu_bound_w1", parentUuid: "prompt-1" },
    alphaPath,
    "line one\n",
  );
  const editAlpha = buildEditRecordPair(
    { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:02:00.000Z", toolId: "toolu_bound_e1", parentUuid: writeAlpha.lastUuid },
    alphaPath,
    "line one\nline two\n",
    "line one\n",
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] },
  );
  const writeBeta = buildWriteRecordPair(
    { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:06:00.000Z", toolId: "toolu_bound_w2", parentUuid: "prompt-2" },
    betaPath,
    "beta line\n",
  );
  const editAlphaAgain = buildEditRecordPair(
    { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:07:00.000Z", toolId: "toolu_bound_e2", parentUuid: writeBeta.lastUuid },
    alphaPath,
    "line one\nline two\nline three\n",
    "line one\nline two\n",
    { oldStart: 2, oldLines: 1, newStart: 2, newLines: 2, lines: [" line two", "+line three"] },
  );
  const wireRecords: object[] = [buildPromptRecord("prompt-1", null, "2026-07-23T10:00:00.000Z", root)];
  wireRecords.push(...writeAlpha.records);
  if (options.withSidechainPrompt) {
    wireRecords.push(buildPromptRecord("sidechain-1", null, "2026-07-23T10:01:30.000Z", root, { isSidechain: true }));
  }
  wireRecords.push(...editAlpha.records);
  wireRecords.push(buildPromptRecord("prompt-2", editAlpha.lastUuid, "2026-07-23T10:05:00.000Z", root));
  wireRecords.push(...writeBeta.records, ...editAlphaAgain.records);
  if (options.withFinalPrompt) {
    wireRecords.push(buildPromptRecord("prompt-3", editAlphaAgain.lastUuid, "2026-07-23T10:10:00.000Z", root));
  }
  const records = writeTranscriptFixture(tree.projectDir, "bound.jsonl", wireRecords);
  return { records, alphaPath: new Path(alphaPath) };
}
