// Task 357 step 3: transcript files group into session + subagents, graft, and yield the rewound branches that have a real tip.

import { statSync } from "node:fs";
import { loadTranscript } from "./parse/loadTranscript.ts";
import { findConversationBranches } from "./reconstruction_branch.ts";
import { attachForkedSubagentRoots } from "./reconstruction_fork_graft.ts";
import { indexRecordsByUuid } from "./reconstruction_tree.ts";
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
export function groupSessionFiles(files: readonly Path[]): SessionFileGroup[] {
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
  return [...groupsByParent.values()].sort((left, right) => left.parentFile.toString().localeCompare(right.parentFile.toString()));
}

function loadGroupRecords(group: SessionFileGroup): TranscriptRecord[] {
  const files = [group.parentFile, ...group.subagentFiles];
  const records = files.flatMap((file) => loadTranscript(file.toString(), undefined, true).records);
  return attachForkedSubagentRoots(records);
}

// A branch whose tip resolves to no record is the session's unnamed main line, not a rewind.
function listRewoundBranches(records: TranscriptRecord[]): RewoundBranch[] {
  const byUuid = indexRecordsByUuid(records);
  const rewound: RewoundBranch[] = [];
  for (const branch of findConversationBranches(records)) {
    if (!branch.isSurviving && branch.rewindPoint !== undefined && byUuid.has(branch.tip.toString())) {
      rewound.push({ tip: branch.tip, rewindPoint: branch.rewindPoint });
    }
  }
  return rewound;
}

export function loadSessionRewinds(group: SessionFileGroup): SessionRewinds {
  const mtimeKey = [group.parentFile, ...group.subagentFiles].map((file) => `${file.toString()}@${statSync(file.toString()).mtimeMs}`).join(",");
  const key = group.parentFile.toString();
  const cached = rewindsByParentFile.get(key);
  if (cached !== undefined && cached.mtimeKey === mtimeKey) {
    return cached.rewinds;
  }
  const records = loadGroupRecords(group);
  const rewinds = { parentFile: group.parentFile, records, branches: listRewoundBranches(records) };
  rewindsByParentFile.set(key, { mtimeKey, rewinds });
  return rewinds;
}
