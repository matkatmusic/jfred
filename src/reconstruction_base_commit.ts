// Splices a tier-1 WriteEvent from the configured base commit into each file's event lineage.

import { execSync } from "node:child_process";
import { relative } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import { EventKind, FailureScope } from "./structures/vocabulary.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { FileEvent, WriteEvent } from "./reconstruction_engine.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { noteReconstructionFailure } from "./reconstruction_health.ts";
import { noteStage } from "./reconstruction_provenance.ts";

export const BASE_COMMIT_CHANGE_ID_PREFIX = "gitBase:";

// Task 56: controls whether pre-beacon events are replayed or dropped.
let preBaselineReconstructionAllowed = true;

export function setPreBaselineReconstructionAllowed(allowed: boolean): void {
    preBaselineReconstructionAllowed = allowed;
}

// Task 151: cache-group key — different answers must not share derived caches.
export function isPreBaselineReconstructionAllowed(): boolean {
    return preBaselineReconstructionAllowed;
}

// Task 151: memoized cutoff instant; runs at-or-before it are skipped.
let skippedBaselineCutoffCache: { cachedFor: string; cutoff: Date | undefined } | undefined;

export function computeSkippedBaselineCutoff(): Date | undefined {
    if (preBaselineReconstructionAllowed) {
        return undefined;
    }
    const { repoDir, baseCommit } = getPathOverrides();
    if (repoDir === undefined) {
        return undefined;
    }
    if (baseCommit === undefined) {
        return undefined;
    }
    const cachedFor = `${repoDir.toString()}|${baseCommit.toString()}`;
    if (skippedBaselineCutoffCache?.cachedFor !== cachedFor) {
        skippedBaselineCutoffCache = { cachedFor, cutoff: readCommitTimestamp(repoDir, baseCommit) };
    }
    return skippedBaselineCutoffCache.cutoff;
}

// Task 151: true when this run is superseded by a declined baseline.
export function checkTimestampPrecedesSkippedBaseline(timestamp: Date): boolean {
    const cutoff = computeSkippedBaselineCutoff();
    if (cutoff === undefined) {
        return false;
    }
    return timestamp.getTime() <= cutoff.getTime();
}

// Deterministic changeId so every replay of the same baseline agrees.
export function computeBaseCommitChangeId(baseCommit: Uuid, target: Path): Uuid {
    return new Uuid(`${BASE_COMMIT_CHANGE_ID_PREFIX}${baseCommit.toString()}:${target.toString()}`);
}

// Returns the committer timestamp, or undefined if unreadable.
export function readCommitTimestamp(repoDir: Path, baseCommit: Uuid): Date | undefined {
    try {
        const isoInstant = execSync(`git show -s --format=%cI ${JSON.stringify(baseCommit.toString())}`, {
            cwd: repoDir.toString(),
            stdio: "pipe",
        }).toString().trim();
        const timestamp = new Date(isoInstant);
        if (Number.isNaN(timestamp.getTime())) {
            return undefined;
        }
        return timestamp;
    } catch {
        return undefined;
    }
}

// Returns the file content at the given commit, or undefined if absent.
export function readCommitFileContent(repoDir: Path, baseCommit: Uuid, relativePath: string): string | undefined {
    try {
        return execSync(`git show ${baseCommit.toString()}:${JSON.stringify(relativePath)}`, {
            cwd: repoDir.toString(),
            stdio: "pipe",
        }).toString();
    } catch {
        return undefined;
    }
}

// Returns the first record's cwd as the project root.
export function findFirstRecordCwd(records: TranscriptRecord[]): Path | undefined {
    for (const record of records) {
        const cwd = (record as { cwd?: Path }).cwd;
        if (cwd !== undefined) {
            return cwd;
        }
    }
    return undefined;
}

// task 365: the source (with a root) whose root is the longest ancestor-or-equal prefix of target.
function findLongestEnclosingSource(sources: SourceEntry[], target: Path): { source: SourceEntry; root: Path } | undefined {
    const targetString = target.toString();
    let best: { source: SourceEntry; root: Path } | undefined;
    for (const source of sources) {
        if (source.root === undefined) {
            continue;
        }
        const rootString = source.root.toString();
        const isEnclosing = targetString === rootString || targetString.startsWith(rootString + "/");
        if (!isEnclosing) {
            continue;
        }
        if (best === undefined || rootString.length > best.root.toString().length) {
            best = { source, root: source.root };
        }
    }
    return best;
}

// task 365: resolves beacon repo/commit/root per-source when `sources[]` is configured, else today's global values unchanged.
export function resolveBaseCommitEvidenceForTarget(
    records: TranscriptRecord[],
    target: Path,
): { repoDir: Path; baseCommit: Uuid; relativeRoot: Path } | undefined {
    const overrides = getPathOverrides();
    if (overrides.sources === undefined || overrides.sources.length === 0) {
        if (overrides.repoDir === undefined) {
            return undefined;
        }
        if (overrides.baseCommit === undefined) {
            return undefined;
        }
        const relativeRoot = findFirstRecordCwd(records);
        if (relativeRoot === undefined) {
            return undefined;
        }
        return { repoDir: overrides.repoDir, baseCommit: overrides.baseCommit, relativeRoot };
    }
    const enclosing = findLongestEnclosingSource(overrides.sources, target);
    if (enclosing === undefined) {
        return undefined;
    }
    const repoDir = enclosing.source.repoDir ?? overrides.repoDir;
    if (repoDir === undefined) {
        return undefined;
    }
    const baseCommit = enclosing.source.baseCommit ?? overrides.baseCommit;
    if (baseCommit === undefined) {
        return undefined;
    }
    return { repoDir, baseCommit, relativeRoot: enclosing.root };
}

// Splices a tier-1 beacon WriteEvent if the base commit contains this target.
export function seedBaseCommitBeacon(records: TranscriptRecord[], events: FileEvent[], target: Path): FileEvent[] {
    const evidence = resolveBaseCommitEvidenceForTarget(records, target);
    if (evidence === undefined) {
        return events;
    }
    const { repoDir, baseCommit, relativeRoot } = evidence;
    const relativePath = relative(relativeRoot.toString(), target.toString());
    if (relativePath === "") {
        return events;
    }
    if (relativePath.startsWith("..")) {
        return events;
    }
    const timestamp = readCommitTimestamp(repoDir, baseCommit);
    if (timestamp === undefined) {
        // Commit unreadable despite being configured — note as missing evidence.
        noteReconstructionFailure({ scope: FailureScope.fileStage, stage: "seedBaseCommitBeacon", target, reason: "git baseline commit unreadable (recorded repo missing)" });
        return events;
    }
    const content = readCommitFileContent(repoDir, baseCommit, relativePath);
    if (content === undefined) {
        return events;
    }
    const changeId = computeBaseCommitChangeId(baseCommit, target);
    const beacon: WriteEvent = { kind: EventKind.write, changeId, target, content, timestamp };
    // Insert before the first event after the beacon's timestamp.
    const followerIndex = events.findIndex((event) => event.timestamp.getTime() > timestamp.getTime());
    const insertionIndex = followerIndex === -1 ? events.length : followerIndex;
    if (!preBaselineReconstructionAllowed) {
        // Task 56: drop pre-baseline events the beacon supersedes.
        const trimmed = [beacon, ...events.slice(insertionIndex)];
        noteStage({
            stage: "seedBaseCommitBeacon",
            target,
            changeId,
            detail: `seeded a tier-1 write beacon and dropped ${insertionIndex} superseded pre-baseline event(s)`,
            when: timestamp,
        });
        return trimmed;
    }
    const seeded = [...events];
    seeded.splice(insertionIndex, 0, beacon);
    noteStage({
        stage: "seedBaseCommitBeacon",
        target,
        changeId,
        detail: "seeded a tier-1 write beacon from the configured base commit",
        when: timestamp,
    });
    return seeded;
}

