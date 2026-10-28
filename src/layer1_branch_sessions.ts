// Task 357 step 3: group session files, graft subagents, yield rewound branches with a real tip.

import { statSync } from "node:fs";
import { loadTranscript } from "./parse/loadTranscript.ts";
import { findConversationBranches } from "./reconstruction_branch.ts";
import { attachForkedSubagentRoots } from "./reconstruction_fork_graft.ts";
import { buildRecordIndexByUuid } from "./reconstruction_tree.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// Layout: <dir>/<sessionId>/subagents/agent-*.jsonl belongs to <dir>/<sessionId>.jsonl.
const SUBAGENT_FILE_PATTERN = /^(.*\/[^/]+)\/subagents\/agent-[^/]*\.jsonl$/;

export interface SessionFileGroup {
  parentFile: Path;
  subagentFiles: Path[];
}

export interface RewoundBranch {
  tip: Uuid;
  rewindPoint: Uuid;
}

export interface SessionRewinds {
  parentFile: Path;
  records: TranscriptRecord[];
  branches: RewoundBranch[];
}

// ponytail: unbounded, fine for a local viewer
const rewindsByParentFile = new Map<string, { mtimeKey: string; rewinds: SessionRewinds }>();

// A subagent file with no loaded parent is skipped.
export function collectSessionFileGroups(files: readonly Path[]): SessionFileGroup[] {
  const groupsByParent = new Map<string, SessionFileGroup>();
  const subagentPaths: { parentKey: string; file: Path }[] = [];
  for (const file of files) {
    const match = SUBAGENT_FILE_PATTERN.exec(file.toString());
    if (match === null) {
      groupsByParent.set(file.toString(), { parentFile: file, subagentFiles: [] });
    }
    else {
      subagentPaths.push({ parentKey: `${match[1]}.jsonl`, file });
    }
  }
  for (const { parentKey, file } of subagentPaths) {
    groupsByParent.get(parentKey)?.subagentFiles.push(file);
  }
  return [...groupsByParent.values()].sort(compareParentFiles);
}

function compareParentFiles(left: SessionFileGroup, right: SessionFileGroup): number {
  return left.parentFile.toString().localeCompare(right.parentFile.toString());
}

function loadGroupRecords(group: SessionFileGroup): TranscriptRecord[] {
  const files = [group.parentFile, ...group.subagentFiles];
  const records: TranscriptRecord[] = [];
  for (const file of files) {
    records.push(...loadTranscript(file.toString(), undefined, true).records);
  }
  return attachForkedSubagentRoots(records);
}

// A branch whose tip resolves to no record is the session's unnamed main line, not a rewind.
function listRewoundBranches(records: TranscriptRecord[]): RewoundBranch[] {
  const byUuid = buildRecordIndexByUuid(records);
  const rewound: RewoundBranch[] = [];
  for (const branch of findConversationBranches(records)) {
    if (branch.isSurviving) {
      continue;
    }
    if (branch.rewindPoint === undefined) {
      continue;
    }
    const hasTipRecord = byUuid.has(branch.tip.toString());
    if (hasTipRecord) {
      rewound.push({ tip: branch.tip, rewindPoint: branch.rewindPoint });
    }
  }
  return rewound;
}

export function loadSessionRewinds(group: SessionFileGroup): SessionRewinds {
  const mtimeParts: string[] = [];
  for (const file of [group.parentFile, ...group.subagentFiles]) {
    mtimeParts.push(`${file.toString()}@${statSync(file.toString()).mtimeMs}`);
  }
  const mtimeKey = mtimeParts.join(",");
  const key = group.parentFile.toString();
  const cached = rewindsByParentFile.get(key);
  if (cached !== undefined) {
    if (cached.mtimeKey === mtimeKey) {
      return cached.rewinds;
    }
  }
  const records = loadGroupRecords(group);
  const rewinds = { parentFile: group.parentFile, records, branches: listRewoundBranches(records) };
  rewindsByParentFile.set(key, { mtimeKey, rewinds });
  return rewinds;
}
