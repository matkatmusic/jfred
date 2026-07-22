// Branch-aware reconstruction. The branch-agnostic CORE (`reconstructFileOver` /
// `reconstructFilesOver`) reconstructs over EXACTLY the records it is given — no branch selection —
// so any one conversation branch can be reconstructed in isolation. The public surviving-branch API
// (`reconstructFile` / `reconstructAll` in reconstruction_engine.ts) pre-selects the surviving
// branch and calls this core. (Split out of reconstruction_engine.ts to keep both files within the
// 250-line cap — split, never condense.) Design: plans/s7/s7-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { EventKind, FailureScope } from "./structures/vocabulary.ts";
import { noteReconstructionFailure } from "./reconstruction_health.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { replayEvents } from "./reconstruction_replay.ts";
import { fillRedirectContent, seedEditBaseFromBackup } from "./reconstruction_sidecar.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { completeElidedBeacons, completeTruncatedBeacon } from "./reconstruction_beacons.ts";
import { injectScriptExecutions } from "./reconstruction_script_stage.ts";
import {
    enterLineageReplayWindow,
    restoreLineageReplayWindow,
} from "./reconstruction_script_runs.ts";
import {
    countActiveLineageReplayFrames,
    doesReplayWindowKeepInstant,
    findServableLineageSeed,
    isLineageKeyOnReplayStack,
    noteLineageCacheServe,
    recordLineageGuardHit,
    recordLineageKeyQuery,
    runLineageReplayFrame,
    storeLineageSeedWhenCacheable,
} from "./reconstruction_lineage_memo.ts";
// corpus: moved to reconstruction_corpus.ts (item 14) — the gate check now lives in getDerivedCaches
// import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { getDerivedCaches } from "./reconstruction_corpus.ts";
import { placeGitCommitEvidence } from "./reconstruction_git_placement.ts";
import { seedBaseCommitBeacon } from "./reconstruction_base_commit.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";
import { seedStaleEditBases } from "./reconstruction_reseed.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import {
    buildRenameChain,
    eventBelongsToLineage,
    resolveFinalPath,
} from "./reconstruction_lineage.ts";
import {
    lastRevisionAtOrBefore,
    lastRevisionStrictlyBefore,
    linesTextOf,
} from "./reconstruction_revisions.ts";
import type {
    CopyEvent,
    FileEvent,
    FileRevision,
} from "./reconstruction_engine.ts";

// One file's reconstruction memoized per records-array identity. reconstructFileOver is
// deterministic for (records, target, reader, exec-gate), and the document build re-requests the
// same file's history once per pass. Only PURE top-level calls are cached — a call inside copy
// seeding (`resolving` non-empty) or lineage seeding (a replay frame active) is
// stack-dependent (the cycle guards alter what it can see) and computes fresh, exactly as before.
// corpus: moved to reconstruction_corpus.ts (item 14)

// The branch-agnostic core: reconstruct one file's history over EXACTLY the records given (no branch
// selection here) — follow any rename to its final path, keep only that lineage's events, seed any
// copy from its source, then replay. resolving holds the destination paths currently being seeded,
// so a copy cycle (cp a b; cp b a) breaks instead of recursing forever. reader fills bash-redirect
// content from the file-history sidecar before replay (undefined for S1-S4).
export function reconstructFileOver(
    records: TranscriptRecord[],
    target: Path,
    resolving: Set<string>,
    reader?: BackupReader,
): FileRevision[] {
    if (resolving.size > 0 || countActiveLineageReplayFrames() > 0) {
        return computeFileRevisionsOver(records, target, resolving, reader);
    }
    // corpus: moved to reconstruction_corpus.ts (item 14)
    const byTarget = getDerivedCaches(records, reader).historiesByTarget;
    const targetKey = target.toString();
    const cached = byTarget.get(targetKey);
    if (cached !== undefined) {
        return cached;
    }
    const revisions = computeFileRevisionsOver(records, target, resolving, reader);
    byTarget.set(targetKey, revisions);
    return revisions;
}

// Run one chain stage, falling back to its unmodified input when it throws — the file keeps
// every state computed so far and the failure is noted for the wire document.
function runStageTolerantly(
    stage: string,
    target: Path,
    input: FileEvent[],
    run: () => FileEvent[],
): FileEvent[] {
    // task 149: announce before running — the per-target counter label used to freeze at n/n
    // while the whole chain ground silently. The `reconstructing ` prefix keeps the webapp's
    // phase classifier in phase 4.
    reportReconstructionProgress(`reconstructing ${target} — ${stage}`);
    try {
        return run();
    } catch (error) {
        noteReconstructionFailure({ scope: FailureScope.fileStage, stage, target, reason: String(error) });
        return input;
    }
}

function computeFileRevisionsOver(
    records: TranscriptRecord[],
    target: Path,
    resolving: Set<string>,
    reader?: BackupReader,
): FileRevision[] {
    const events = extractFileEvents(records);
    const renameChain = buildRenameChain(events);
    const finalTarget = resolveFinalPath(target, renameChain);
    const lineage = events.filter((event) =>
        eventBelongsToLineage(event, finalTarget, renameChain),
    );
    // task 119: every chain stage runs through runStageTolerantly — a throwing stage (a dead
    // sidecar blob, an unreadable repo) degrades to its input events instead of killing the file.
    // The pre-chain steps above are pure record/event walks (the per-file backstop covers them);
    // replayEvents has its own per-event net.
    // task 119: const baselined = seedBaseCommitBeacon(records, lineage, finalTarget);
    const baselined = runStageTolerantly("seedBaseCommitBeacon", finalTarget, lineage, () => seedBaseCommitBeacon(records, lineage, finalTarget));
    // item 46: const seeded = seedCopyEvents(records, lineage, resolving, reader);
    // task 119: const seeded = seedCopyEvents(records, baselined, resolving, reader);
    const seeded = runStageTolerantly("seedCopyEvents", finalTarget, baselined, () => seedCopyEvents(records, baselined, resolving, reader));
    // task 119: const filled = reader ? fillRedirectContent(records, seeded, reader) : seeded;
    const filled = reader ? runStageTolerantly("fillRedirectContent", finalTarget, seeded, () => fillRedirectContent(records, seeded, reader)) : seeded;
    // task 119: const based = reader ? seedEditBaseFromBackup(records, filled, reader) : filled;
    const based = reader ? runStageTolerantly("seedEditBaseFromBackup", finalTarget, filled, () => seedEditBaseFromBackup(records, filled, reader)) : filled;
    // task 119: const scripted = reader
    // task 119:     ? injectScriptExecutions(records, based, reader, finalTarget, getLineageContentBefore(records, reader))
    // task 119:     : based;
    const scripted = reader
        ? runStageTolerantly("injectScriptExecutions", finalTarget, based, () => injectScriptExecutions(records, based, reader, finalTarget, getLineageContentBefore(records, reader)))
        : based;
    // task 119: const evidenced = reader ? placeGitCommitEvidence(records, scripted, reader, finalTarget) : scripted;
    const evidenced = reader ? runStageTolerantly("placeGitCommitEvidence", finalTarget, scripted, () => placeGitCommitEvidence(records, scripted, reader, finalTarget)) : scripted;
    // task 119: const unelided = reader ? completeElidedBeacons(records, evidenced, reader) : evidenced;
    const unelided = reader ? runStageTolerantly("completeElidedBeacons", finalTarget, evidenced, () => completeElidedBeacons(records, evidenced, reader)) : evidenced;
    // task 119: const restaged = reader ? seedStaleEditBases(records, unelided, reader) : unelided;
    const restaged = reader ? runStageTolerantly("seedStaleEditBases", finalTarget, unelided, () => seedStaleEditBases(records, unelided, reader)) : unelided;
    // task 119: const completed = reader ? completeTruncatedBeacon(records, restaged, reader) : restaged;
    const completed = reader ? runStageTolerantly("completeTruncatedBeacon", finalTarget, restaged, () => completeTruncatedBeacon(records, restaged, reader)) : restaged;
    return replayEvents(completed);
}

// Fill each copy event's seedLines from its source; pass other events through.
function seedCopyEvents(
    records: TranscriptRecord[],
    lineage: FileEvent[],
    resolving: Set<string>,
    reader?: BackupReader,
): FileEvent[] {
    return lineage.map((event) => {
        if (event.kind === EventKind.copy) {
            return seedOneCopy(records, event, resolving, reader);
        }
        return event;
    });
}

// Seed one copy with the source file's content as of the copy timestamp.
function seedOneCopy(
    records: TranscriptRecord[],
    event: CopyEvent,
    resolving: Set<string>,
    reader?: BackupReader,
): CopyEvent {
    const destination = event.to.toString();
    if (resolving.has(destination)) {
        return { ...event, seedLines: [] };
    }
    const next = new Set(resolving);
    next.add(destination);
    const sourceRevisions = reconstructFileOver(records, event.from, next, reader);
    const atCopy = lastRevisionAtOrBefore(sourceRevisions, event.timestamp);
    if (!atCopy) {
        return { ...event, seedLines: [] };
    }
    noteStage({ stage: "seedCopyEvents", target: event.to, changeId: event.changeId, detail: `seeded copy genesis from ${event.from}`, when: event.timestamp });
    return { ...event, seedLines: linesTextOf(atCopy) };
}

// Lineage-seed texts memoized per records-array identity, keyed "path|beforeMs". Task 162: the
// cycle-guard stack and the proof rules for WHICH replays are safe to cache/serve (nested ones
// included) live in reconstruction_lineage_memo.ts; the reader-identity/exec-gate validity
// re-check is the corpus's job (getDerivedCaches).

// The seed text of a replayed revision, or undefined when the lineage has no revision to offer.
function computeSeededText(revisionBefore: FileRevision | undefined): string | undefined {
    if (revisionBefore === undefined) return undefined;
    // splitLines drops one trailing newline, so restore it — the stage's byte-exact
    // beacon compare fails without it.
    return linesTextOf(revisionBefore).join("\n") + "\n";
}

// Replay the target's own reconstruction up to `before` — the callback body of
// getLineageContentBefore, extracted to module scope.
function replayLineageContentBefore(
    records: TranscriptRecord[],
    reader: BackupReader,
    target: Path,
    before: Date,
): string | undefined {
    const cycleKey = `${target.toString()}|${before.getTime()}`;
    recordLineageKeyQuery(cycleKey);
    if (isLineageKeyOnReplayStack(cycleKey)) {
        recordLineageGuardHit(cycleKey);
        return undefined;
    }
    const seedsByKey = getDerivedCaches(records, reader).lineageSeedsByKey;
    const previousCutoff = enterLineageReplayWindow(before);
    try {
        // Cache reads/writes are valid only for replays the memo module can PROVE identical to a
        // fresh compute (window kept its instant, no queried dependency in flight) — task 162.
        const windowKeptInstant = doesReplayWindowKeepInstant(previousCutoff, before);
        const servableEntry = findServableLineageSeed(seedsByKey, cycleKey, windowKeptInstant);
        if (servableEntry !== null) {
            noteLineageCacheServe(servableEntry);
            return servableEntry.text;
        }
        reportReconstructionProgress(`replaying lineage of ${target}`);
        const replayed = runLineageReplayFrame(cycleKey, () => {
            const revisions = reconstructFileOver(records, target, new Set(), reader);
            return computeSeededText(lastRevisionStrictlyBefore(revisions, before));
        });
        storeLineageSeedWhenCacheable(seedsByKey, cycleKey, replayed.cacheable, windowKeptInstant);
        return replayed.text;
    } finally {
        restoreLineageReplayWindow(previousCutoff);
    }
}

// A LineageContentBefore that replays the target's own reconstruction up to `before`.
export function getLineageContentBefore(records: TranscriptRecord[], reader: BackupReader): LineageContentBefore {
    return (target, before) => replayLineageContentBefore(records, reader, target, before);
}

