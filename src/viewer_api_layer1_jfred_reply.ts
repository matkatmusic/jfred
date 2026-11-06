// Builds the reply of POST /api/layer1-jfred-commit (task 361, phase 4): engine files at the mark, then the commit or the next change.

import { JfredCommitOutcome, type WireJfredCommitReplyOf, type WireJfredCommitRequest } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { Path } from "./structures/domain.ts";
import { buildJfredReconstruction, findNextChangingInstant, listEngineFilesAt } from "./viewer_api_layer1_jfred_engine.ts";
import { listPathsEndingWithNewline } from "./viewer_api_layer1_jfred_newline.ts";
import { writeJfredMarkCommit } from "./viewer_api_layer1_jfred_write.ts";
import { getRequestedRef, getRequestedTimeSource } from "./viewer_api_layer1_route.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { reportStage } from "./viewer_api_records.ts";

export interface CommitInput {
  query: URLSearchParams;
  dir: Path;
  repoDir: Path;
  request: WireJfredCommitRequest;
  markInstant: Date;
}

function createNewlinePathFinder(input: CommitInput, sessionFiles: Path[]): (relativePaths: string[]) => Set<string> {
  const source = { dir: input.dir, repoDir: input.repoDir, ref: getRequestedRef(input.query), timeSource: getRequestedTimeSource(input.query), sessionFiles };
  return (relativePaths: string[]): Set<string> => listPathsEndingWithNewline(source, relativePaths, input.markInstant);
}

export function buildCommitReply(input: CommitInput, onProgress: ProgressSink): WireJfredCommitReplyOf<Date> {
  const sessionFiles = listTranscriptFiles(input.query.getAll("jsonl"));
  const built = buildJfredReconstruction(sessionFiles, onProgress);
  reportStage(onProgress, "reading the files at the mark");
  const engineTexts = listEngineFilesAt(input.dir, built.stepFileHistories, input.markInstant);
  const findNewlinePaths = createNewlinePathFinder(input, sessionFiles);
  reportStage(onProgress, "comparing the files with the parent commit");
  const commit = writeJfredMarkCommit(input.repoDir, input.request, new Date(), engineTexts, findNewlinePaths);
  if (commit !== undefined) {
    return { outcome: JfredCommitOutcome.committed, commit };
  }
  reportStage(onProgress, "looking for the next change");
  const nextInstant = findNextChangingInstant(input.dir, built, input.markInstant, engineTexts);
  return { outcome: JfredCommitOutcome.unchanged, nextInstant };
}
