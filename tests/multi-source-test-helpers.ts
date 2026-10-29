// Fabrication helpers for the multi-source merge tests: two-source temp trees, loaded through loadTranscript for real source stamps.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import type { SourceEntry } from "../src/reconstruction_overrides.ts";
import { buildEditRecordPair, buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";

export const SESSION_A = "aaaaaaaa-1111-2222-3333-444444444444";
export const SESSION_B = "bbbbbbbb-1111-2222-3333-444444444444";

export type SourceTree = { treeRoot: string; projectDir: string };

// A copied-out-of-~/.claude tree: <X>/projects/<projectName> plus the <X>/file-history sibling.
export function createSourceTree(projectName: string): SourceTree {
  const treeRoot = mkdtempSync(join(tmpdir(), "multi-source-test-"));
  const projectDir = join(treeRoot, "projects", projectName);
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(treeRoot, "file-history"));
  return { treeRoot, projectDir };
}

// Write records one-per-line into <projectDir>/<name>, then load them back so each carries its source stamp.
export function writeTranscriptFixture(projectDir: string, name: string, records: object[]): TranscriptRecord[] {
  const jsonlPath = join(projectDir, name);
  let jsonlText = "";
  for (const record of records) {
    jsonlText += JSON.stringify(record) + "\n";
  }
  writeFileSync(jsonlPath, jsonlText);
  return loadTranscript(jsonlPath).records;
}

// A typed-in user prompt record (a turn boundary); isSidechain marks a subagent prompt, not a boundary.
export function buildPromptRecord(
  uuid: string,
  parentUuid: string | null,
  timestamp: string,
  cwd: string,
  options?: { isSidechain?: boolean; sessionId?: string },
): object {
  const record: Record<string, unknown> = {
    type: "user",
    uuid,
    parentUuid,
    sessionId: options?.sessionId ?? SESSION_A,
    timestamp,
    cwd,
    message: { role: "user", content: "next task" },
  };
  if (options?.isSidechain === true) {
    record.isSidechain = true;
  }
  return record;
}

export type TwoSourceFixture = {
  listA: TranscriptRecord[];
  listB: TranscriptRecord[];
  sources: SourceEntry[];
  rootA: string;
  rootB: string;
  alphaPath: string;
  betaPath: string;
};

// Source A writes app.py at 10:00; source B edits its own app.py at 10:05 with the given originalFile.
export function createTwoSourceEditFixture(
  originalFileSeenByB: string,
  buildExtraRecordsA?: (locations: { rootA: string; alphaPath: string }) => object[],
): TwoSourceFixture {
  const treeA = createSourceTree("-alpha-project");
  const treeB = createSourceTree("-beta-project");
  const rootA = join(treeA.treeRoot, "workspace-alpha");
  const rootB = join(treeB.treeRoot, "workspace-beta");
  const alphaPath = join(rootA, "app.py");
  const betaPath = join(rootB, "app.py");
  const write = buildWriteRecordPair(
    { sessionId: SESSION_A, cwd: rootA, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_write_a1", parentUuid: null },
    alphaPath,
    "line one\n",
  );
  const edit = buildEditRecordPair(
    { sessionId: SESSION_B, cwd: rootB, timestamp: "2026-07-22T10:05:00.000Z", toolId: "toolu_edit_b1", parentUuid: null },
    betaPath,
    "line one\nline two\n",
    originalFileSeenByB,
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] },
  );
  const extraRecordsA = buildExtraRecordsA === undefined ? [] : buildExtraRecordsA({ rootA, alphaPath });
  const listA = writeTranscriptFixture(treeA.projectDir, "a.jsonl", [...write.records, ...extraRecordsA]);
  const listB = writeTranscriptFixture(treeB.projectDir, "b.jsonl", edit.records);
  const sources: SourceEntry[] = [
    { projectsDir: new Path(join(treeA.treeRoot, "projects")), root: new Path(rootA) },
    { projectsDir: new Path(join(treeB.treeRoot, "projects")), root: new Path(rootB) },
  ];
  return { listA, listB, sources, rootA, rootB, alphaPath, betaPath };
}
