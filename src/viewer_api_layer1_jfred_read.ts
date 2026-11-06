// Phase 2 of task 361: read the hidden jfred branch into the Layer 1 `jfredCommits` wire data.

import { runJfredGit } from "./viewer_api_layer1_jfred_git.ts";
import { Path } from "./structures/domain.ts";
import { CommitTimeSource } from "../webapp/layer1-wire.ts";
import { JFRED_BRANCH_NAME, JFRED_SHORT_HASH_LENGTH, JFRED_SUBJECT_PREFIX, type WireJfredBaseOf, type WireJfredCommitOf, type WireJfredCommitsOf } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";

const RECORD_MARK = "\x1e";
const FIELD_MARK = "\x1f";

export interface JfredBranchRead {
  baseHash: string;
  commits: WireJfredCommitOf<Date>[];
}

interface JfredLogRecord {
  hash: string;
  authorIso: string;
  parentHash: string;
  message: string;
}

function isJfredBranchPresent(repoDir: Path): boolean {
  const refs = runJfredGit(repoDir, ["for-each-ref", "--format=%(refname)", `refs/heads/${JFRED_BRANCH_NAME}`]);
  return refs !== "";
}

function parseJfredLog(output: string): JfredLogRecord[] {
  const records: JfredLogRecord[] = [];
  for (const rawRecord of output.split(RECORD_MARK)) {
    const recordText = rawRecord.trim();
    if (recordText === "")
      continue;
    const [hash, authorIso, parentHashes, message] = recordText.split(FIELD_MARK);
    const parentHash = parentHashes!.split(" ")[0]!;
    records.push({ hash: hash!, authorIso: authorIso!, parentHash, message: message!.trim() });
  }
  return records;
}

function convertRecordToWireCommit(record: JfredLogRecord): WireJfredCommitOf<Date> {
  return {
    instant: new Date(record.authorIso),
    shortHash: record.hash.slice(0, JFRED_SHORT_HASH_LENGTH),
    parentShortHash: record.parentHash.slice(0, JFRED_SHORT_HASH_LENGTH),
    message: record.message,
  };
}

function splitBaseFromCommits(records: JfredLogRecord[]): JfredBranchRead {
  const newestFirst: WireJfredCommitOf<Date>[] = [];
  for (const record of records) {
    const isJfredCommit = record.message.startsWith(JFRED_SUBJECT_PREFIX);
    if (!isJfredCommit) {
      return { baseHash: record.hash, commits: newestFirst.reverse() };
    }
    newestFirst.push(convertRecordToWireCommit(record));
  }
  throw new Error(`the ${JFRED_BRANCH_NAME} branch has no base commit: every commit has the jfred subject`);
}

// ponytail: one git log of the whole first-parent chain; page it past a few thousand jfred commits.
export function listJfredBranchCommits(repoDir: Path): JfredBranchRead | undefined {
  const isBranchPresent = isJfredBranchPresent(repoDir);
  if (!isBranchPresent)
    return undefined;
  const output = runJfredGit(repoDir, ["log", "--first-parent", `--format=%H${FIELD_MARK}%aI${FIELD_MARK}%P${FIELD_MARK}%B${RECORD_MARK}`, `refs/heads/${JFRED_BRANCH_NAME}`]);
  return splitBaseFromCommits(parseJfredLog(output));
}

function readBaseWire(repoDir: Path, baseHash: string, timeSource: CommitTimeSource): WireJfredBaseOf<Date> {
  const dateFormat = timeSource === CommitTimeSource.author ? "%aI" : "%cI";
  const instantIso = runJfredGit(repoDir, ["log", "-1", `--format=${dateFormat}`, baseHash]);
  return { instant: new Date(instantIso), shortHash: baseHash.slice(0, JFRED_SHORT_HASH_LENGTH) };
}

export function buildJfredBranchView(repoDir: Path, timeSource: CommitTimeSource): WireJfredCommitsOf<Date> {
  const branch = listJfredBranchCommits(repoDir);
  if (branch === undefined)
    return { commits: [] };
  return { base: readBaseWire(repoDir, branch.baseHash, timeSource), commits: branch.commits };
}
