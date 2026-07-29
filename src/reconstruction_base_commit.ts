// Splices a tier-1 WriteEvent from the configured base commit into each file's event lineage.

import { execSync } from "node:child_process";
import { relative } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import { EventKind, FailureScope } from "./structures/vocabulary.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { FileEvent, WriteEvent } from "./reconstruction_engine.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
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

// Splices a tier-1 beacon WriteEvent if the base commit contains this target.
export function seedBaseCommitBeacon(records: TranscriptRecord[], events: FileEvent[], target: Path): FileEvent[] {
    const { repoDir, baseCommit } = getPathOverrides();
    if (repoDir === undefined) {
        return events;
    }
    if (baseCommit === undefined) {
        return events;
    }
    const recordedRoot = findFirstRecordCwd(records);
    if (recordedRoot === undefined) {
        return events;
    }
    // ponytail: assumes the repo root IS the recorded cwd — pass a config repoRelativeRoot
    // if a nested-repo scenario ever appears.
    const relativePath = relative(recordedRoot.toString(), target.toString());
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

