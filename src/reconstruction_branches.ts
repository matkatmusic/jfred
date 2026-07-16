// Branch-aware reconstruction. The branch-agnostic CORE (`reconstructFileOver` /
// `reconstructFilesOver`) reconstructs over EXACTLY the records it is given — no branch selection —
// so any one conversation branch can be reconstructed in isolation. The public surviving-branch API
// (`reconstructFile` / `reconstructAll` in reconstruction_engine.ts) pre-selects the surviving
// branch and calls this core. (Split out of reconstruction_engine.ts to keep both files within the
// 250-line cap — split, never condense.) Design: plans/s7/s7-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
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
// seeding (`resolving` non-empty) or lineage seeding (`seedingLineages` non-empty) is
// stack-dependent (the cycle guards alter what it can see) and computes fresh, exactly as before.
// corpus: moved to reconstruction_corpus.ts (item 14)
// type FileOverCache = {
//     reader: BackupReader | undefined;
//     impureAllowed: boolean;
//     byTarget: Map<string, FileRevision[]>;
// };
// const fileOverCaches = new WeakMap<TranscriptRecord[], FileOverCache>();

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
    if (resolving.size > 0 || seedingLineages.size > 0) {
        return computeFileRevisionsOver(records, target, resolving, reader);
    }
    // corpus: moved to reconstruction_corpus.ts (item 14)
    // let cache = fileOverCaches.get(records);
    // if (cache === undefined || cache.reader !== reader || cache.impureAllowed !== isImpureExecutionAllowed()) {
    //     cache = { reader, impureAllowed: isImpureExecutionAllowed(), byTarget: new Map<string, FileRevision[]>() };
    //     fileOverCaches.set(records, cache);
    // }
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
    const baselined = seedBaseCommitBeacon(records, lineage, finalTarget);
    // item 46: const seeded = seedCopyEvents(records, lineage, resolving, reader);
    const seeded = seedCopyEvents(records, baselined, resolving, reader);
    const filled = reader ? fillRedirectContent(records, seeded, reader) : seeded;
    const based = reader ? seedEditBaseFromBackup(records, filled, reader) : filled;
    const scripted = reader
        ? injectScriptExecutions(records, based, reader, finalTarget, getLineageContentBefore(records, reader))
        : based;
    const evidenced = reader ? placeGitCommitEvidence(records, scripted, reader, finalTarget) : scripted;
    const unelided = reader ? completeElidedBeacons(records, evidenced, reader) : evidenced;
    const restaged = reader ? seedStaleEditBases(records, unelided, reader) : unelided;
    const completed = reader ? completeTruncatedBeacon(records, restaged, reader) : restaged;
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

// Files currently being lineage-seeded, keyed "path|beforeMs" — breaks seed→reconstruct→seed cycles.
const seedingLineages = new Set<string>();

// Lineage-seed texts memoized per records-array identity, keyed "path|beforeMs". Only replays
// that STARTED on a clean seeding stack are cached: a nested replay's result can be degraded by
// the cycle guards of the replays above it (same reason reconstructFileOver computes fresh while
// seedingLineages is non-empty). The reader-identity/exec-gate validity re-check is the corpus's
// job (getDerivedCaches).
// corpus: moved to reconstruction_corpus.ts (item 14)
// type LineageSeedCache = {
//     reader: BackupReader | undefined;
//     impureAllowed: boolean;
//     byKey: Map<string, string | undefined>;
// };
// const lineageSeedCaches = new WeakMap<TranscriptRecord[], LineageSeedCache>();
//
// function getLineageSeedCache(records: TranscriptRecord[], reader: BackupReader): LineageSeedCache {
//     const cached = lineageSeedCaches.get(records);
//     if (cached !== undefined) {
//         if (cached.reader === reader) {
//             if (cached.impureAllowed === isImpureExecutionAllowed()) {
//                 return cached;
//             }
//         }
//     }
//     const fresh: LineageSeedCache = {
//         reader,
//         impureAllowed: isImpureExecutionAllowed(),
//         byKey: new Map<string, string | undefined>(),
//     };
//     lineageSeedCaches.set(records, fresh);
//     return fresh;
// }

// The seed text of a replayed revision, or undefined when the lineage has no revision to offer.
function computeSeededText(revisionBefore: FileRevision | undefined): string | undefined {
    if (revisionBefore === undefined) return undefined;
    // splitLines drops one trailing newline, so restore it — the stage's byte-exact
    // beacon compare fails without it.
    return linesTextOf(revisionBefore).join("\n") + "\n";
}

// A LineageContentBefore that replays the target's own reconstruction up to `before`.
export function getLineageContentBefore(records: TranscriptRecord[], reader: BackupReader): LineageContentBefore {
    return (target, before) => {
        const cycleKey = `${target.toString()}|${before.getTime()}`;
        if (seedingLineages.has(cycleKey)) return undefined;
        const enteredWithCleanStack = seedingLineages.size === 0;
        // corpus: moved to reconstruction_corpus.ts (item 14)
        // const cache = getLineageSeedCache(records, reader);
        const seedsByKey = getDerivedCaches(records, reader).lineageSeedsByKey;
        if (enteredWithCleanStack) {
            if (seedsByKey.has(cycleKey)) {
                return seedsByKey.get(cycleKey);
            }
        }
        const previousCutoff = enterLineageReplayWindow(before);
        seedingLineages.add(cycleKey);
        try {
            reportReconstructionProgress(`replaying lineage of ${target}`);
            const revisions = reconstructFileOver(records, target, new Set(), reader);
            const revisionBefore = lastRevisionStrictlyBefore(revisions, before);
            const seededText = computeSeededText(revisionBefore);
            if (enteredWithCleanStack) {
                seedsByKey.set(cycleKey, seededText);
            }
            return seededText;
        } finally {
            seedingLineages.delete(cycleKey);
            restoreLineageReplayWindow(previousCutoff);
        }
    };
}

