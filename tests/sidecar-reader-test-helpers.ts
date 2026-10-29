// Shared fixtures for the sidecar reader tests: copied ~/.claude trees and blobs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

// A copied-out-of-~/.claude tree: <X>/projects plus, optionally, the <X>/file-history sibling.
export function createCopiedTree(withSibling: boolean): { treeRoot: string; projectDir: string } {
  const treeRoot = createTempDir();
  const projectDir = join(treeRoot, "projects", "-copied-project");
  mkdirSync(projectDir, { recursive: true });
  if (withSibling) {
    mkdirSync(join(treeRoot, "file-history"));
  }
  return { treeRoot, projectDir };
}

// Goes through loadTranscript so each record carries a real source, which drives root derivation.
export function loadMinimalTranscript(projectDir: string, name: string, sessionId: string = "11111111-2222-3333-4444-555555555555"): TranscriptRecord[] {
  const jsonlPath = join(projectDir, name);
  const minimalRecord = { type: RecordType.aiTitle, sessionId, aiTitle: "t" };
  writeFileSync(jsonlPath, `${JSON.stringify(minimalRecord)}\n`);
  return loadTranscript(jsonlPath).records;
}

export function writeBlobForSession(treeRoot: string, sessionId: string, blobName: string, content: string): void {
  const blobDir = join(treeRoot, "file-history", sessionId);
  mkdirSync(blobDir, { recursive: true });
  writeFileSync(join(blobDir, blobName), content);
}
