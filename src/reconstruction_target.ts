// Target-scoped surviving-branch reconstruction (task 192, optimizations.md Phase 1): the `--branch surviving --file <path>` fast path. Reconstructs EXACTLY the requested final target over the surviving records — never touching reconstructBranches, buildRewoundBranchHistory, reconstructFilesOver, discoverScriptCreatedPaths, collectAcceptedUserEditIds, or the step/document builders — while preserving the all-files path's exact-final-path selector contract byte for byte.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { CliOptions } from "./reconstruction_cli_args.ts";
import type { FileHistory } from "./reconstruction_engine.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { selectLiveBranch } from "./reconstruction_branch.ts";
import { appendScriptMoveRenames } from "./reconstruction_script_move_events.ts";
import { getLineageContentBefore, reconstructFileOver } from "./reconstruction_branches.ts";
import {
    buildRenameChain,
    distinctFinalPaths,
    resolveFinalPath,
} from "./reconstruction_lineage.ts";

// The literal branch id that selects the surviving branch — the one branch the fast path serves.
const SURVIVING_BRANCH_ID = "surviving";

// One file's history over EXACTLY the records given, or undefined when the all-files reconstruction would not expose `target` as a final path: a request for an old rename source must NOT become a new result (parity with the CLI's exact-final-path filter).
export function reconstructFileHistoryOver(
    records: TranscriptRecord[],
    target: Path,
    reader?: BackupReader,
): FileHistory | undefined {
    const extracted = extractFileEvents(records);
    // Sandbox-proven script moves join the chain exactly as in reconstructFilesOver — the executions are memoized per records identity, so reconstructFileOver pays them anyway.
    const events = reader
        ? appendScriptMoveRenames(extracted, records, reader, getLineageContentBefore(records, reader))
        : extracted;
    const renameChain = buildRenameChain(events);
    if (resolveFinalPath(target, renameChain).toString() !== target.toString()) {
        return undefined;
    }
    const finalPaths = distinctFinalPaths(events, renameChain);
    const isKnownFinalPath = finalPaths.some((path) => path.toString() === target.toString());
    const revisions = reconstructFileOver(records, target, new Set<string>(), reader);
    if (isKnownFinalPath) {
        return { target, revisions };
    }
    // ponytail: a discovered-but-zero-revision script-born path returns undefined here where the all-files path emits an empty history; no scenario exercises that corner.
    if (revisions.length > 0) {
        return { target, revisions };
    }
    return undefined;
}

// The surviving-branch wrapper: select the surviving records once (corpus-memoized), then reconstruct only the requested target over them.
export function reconstructSurvivingFileHistory(
    records: TranscriptRecord[],
    target: Path,
    reader?: BackupReader,
): FileHistory | undefined {
    return reconstructFileHistoryOver(selectLiveBranch(records), target, reader);
}

// Whether a CLI request selects exactly (surviving branch, one target) — the condition that routes both JSON and text dispatch through the fast path before reconstructBranches.
export function isTargetedSurvivingRequest(options: CliOptions): boolean {
    if (options.branch !== SURVIVING_BRANCH_ID) {
        return false;
    }
    return options.target !== undefined;
}

// The zero-or-one history array the CLI renders for a targeted surviving request — the same shape filterByTarget produces from the all-files reconstruction.
export function listTargetedSurvivingHistories(
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
    target: Path,
): FileHistory[] {
    const history = reconstructSurvivingFileHistory(records, target, reader);
    if (history === undefined) {
        return [];
    }
    return [history];
}
