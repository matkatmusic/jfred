// Builds the reply of POST /api/layer1-jfred-commit: the commit, or the next changing instant.

import { JfredCommitOutcome, type WireJfredCommitReplyOf, type WireJfredCommitRequest } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { listBeaconCandidates, type BeaconCandidate } from "./layer1_beacon_candidates.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { PathOverrides } from "./reconstruction_overrides.ts";
import type { BuiltReconstruction } from "./reconstruction_json.ts";
import type { Path } from "./structures/domain.ts";
import { buildCommitPathOverrides, buildJfredReconstruction, findNextChangingInstant, listEngineFilesAt, listUnrebuiltFilesAt, type UnrebuiltFile } from "./viewer_api_layer1_jfred_engine.ts";
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

function assertUnrebuiltFilesHaveNextInstant(files: UnrebuiltFile[], markInstant: Date): void {
  for (const { relativePath, reason, nextInstant } of files) {
    if (nextInstant === undefined) {
      throw new Error(`jfred commit stopped: the engine could not rebuild ${relativePath} at ${markInstant.toISOString()}: ${reason}`);
    }
  }
}

function selectLaterInstant(current: Date | undefined, candidate: Date): Date {
  if (current === undefined) {
    return candidate;
  }
  const isLater = candidate.getTime() > current.getTime();
  if (isLater) {
    return candidate;
  }
  return current;
}

function findLatestNextInstant(files: UnrebuiltFile[]): Date | undefined {
  let latest: Date | undefined;
  for (const { nextInstant } of files) {
    if (nextInstant !== undefined) {
      latest = selectLaterInstant(latest, nextInstant);
    }
  }
  return latest;
}

// A file with no next beacon stops the commit; else the mark moves to the latest one.
function buildUnrebuiltReply(files: UnrebuiltFile[], markInstant: Date): WireJfredCommitReplyOf<Date> | undefined {
  assertUnrebuiltFilesHaveNextInstant(files, markInstant);
  const nextInstant = findLatestNextInstant(files);
  if (nextInstant === undefined) {
    return undefined;
  }
  const paths: string[] = [];
  for (const file of files) {
    paths.push(file.relativePath);
  }
  return { outcome: JfredCommitOutcome.unrebuilt, paths: paths.sort(), nextInstant };
}

function findUnrebuiltReply(input: CommitInput, built: BuiltReconstruction, sessionFiles: Path[], overrides: PathOverrides): WireJfredCommitReplyOf<Date> | undefined {
  function listBeacons(target: Path): BeaconCandidate[] {
    return listBeaconCandidates(target, sessionFiles, input.repoDir, overrides.sources, overrides);
  }
  const files = listUnrebuiltFilesAt(input.dir, built.stepFileHistories, input.markInstant, listBeacons);
  return buildUnrebuiltReply(files, input.markInstant);
}

export function buildCommitReply(input: CommitInput, onProgress: ProgressSink): WireJfredCommitReplyOf<Date> {
  const sessionFiles = listTranscriptFiles(input.query.getAll("jsonl"));
  const overrides = buildCommitPathOverrides(input.dir, input.repoDir);
  const built = buildJfredReconstruction(sessionFiles, overrides, input.request.allowScripts, onProgress);
  reportStage(onProgress, "reading the files at the mark");
  const engineTexts = listEngineFilesAt(input.dir, built.stepFileHistories, input.markInstant);
  const unrebuiltReply = findUnrebuiltReply(input, built, sessionFiles, overrides);
  if (unrebuiltReply !== undefined) {
    return unrebuiltReply;
  }
  return writeOrFindNextReply(input, built, sessionFiles, engineTexts, onProgress);
}

function writeOrFindNextReply(input: CommitInput, built: BuiltReconstruction, sessionFiles: Path[], engineTexts: Map<string, string>, onProgress: ProgressSink): WireJfredCommitReplyOf<Date> {
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
