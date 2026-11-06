// Target-scoped surviving-branch fast path for `--branch surviving --file <path>` (task 192).

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { CliOptions } from "./reconstruction_cli_args.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import type { PathOverrides } from "./reconstruction_overrides.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { selectLiveBranch } from "./reconstruction_branch.ts";
import { appendScriptMoveRenames } from "./reconstruction_script_move_events.ts";
import { getFileRevisionsOver } from "./reconstruction_branches.ts";
import { getLineageContentBefore } from "./reconstruction_lineage_content.ts";
import {
  buildRenameChain,
  collectDistinctFinalPaths,
  getFinalPath,
} from "./reconstruction_lineage.ts";

// The branch id that selects the surviving branch.
const SURVIVING_BRANCH_ID = "surviving";

// One file's history over the given records, or undefined when target is not a final path.
export function getFileHistoryOver(
  records: TranscriptRecord[],
  target: Path,
  overrides: PathOverrides,
  reader?: BackupReader,
): FileHistory | undefined {
  const extracted = extractFileEvents(records);
  // Script moves join the rename chain, as in getFileHistoriesOver.
  const events = reader
    ? appendScriptMoveRenames(extracted, records, reader, overrides, getLineageContentBefore(records, reader, overrides))
    : extracted;
  const renameChain = buildRenameChain(events);
  const resolvedTarget = getFinalPath(target, renameChain);
  const isFinalPathOfTarget = resolvedTarget.equals(target);
  if (!isFinalPathOfTarget) {
    return undefined;
  }
  const finalPaths = collectDistinctFinalPaths(events, renameChain);
  let isKnownFinalPath = false;
  for (const finalPath of finalPaths) {
    const isTarget = finalPath.equals(target);
    if (isTarget) {
      isKnownFinalPath = true;
    }
  }
  const revisions = getFileRevisionsOver(records, target, new Set<string>(), overrides, reader);
  if (isKnownFinalPath) {
    return { target, revisions };
  }
  // ponytail: a zero-revision script-born path returns undefined here; no scenario exercises it.
  if (revisions.length > 0) {
    return { target, revisions };
  }
  return undefined;
}

// Selects the surviving records once, then builds only the requested target's history.
export function getSurvivingFileHistory(
  records: TranscriptRecord[],
  target: Path,
  overrides: PathOverrides,
  reader?: BackupReader,
): FileHistory | undefined {
  return getFileHistoryOver(selectLiveBranch(records), target, overrides, reader);
}

// Whether a CLI request selects the surviving branch and one target.
export function isTargetedSurvivingRequest(options: CliOptions): boolean {
  if (options.branch !== SURVIVING_BRANCH_ID) {
    return false;
  }
  return options.target !== undefined;
}

// The zero-or-one history array the CLI renders for a targeted surviving request.
export function listTargetedSurvivingHistories(
  records: TranscriptRecord[],
  reader: BackupReader | undefined,
  target: Path,
  overrides: PathOverrides,
): FileHistory[] {
  const history = getSurvivingFileHistory(records, target, overrides, reader);
  if (history === undefined) {
    return [];
  }
  return [history];
}
