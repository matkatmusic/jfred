// The item-46 base-commit beacon stage: when the user configures `repoDir` + `baseCommit`
// overrides, the named commit's tree is TIER-1 ground truth for a file's starting content —
// this stage splices a WriteEvent of the committed bytes at the commit's committer timestamp
// into the lineage before any reader-gated stage runs. Because the beacon is ordered by
// timestamp, the MID-SESSION-SUPERSEDES rule falls out of ordinary replay: any transcript
// event after the commit time overwrites the baseline, and a mid-session commit lands
// mid-stream, superseding only what came before it.
//
// This stage deliberately does NOT gate on `isImpureExecutionAllowed()` — that gate guards
// shell-outs derived from TRANSCRIPT-recorded commands (untrusted input); here the repo and
// commit are the user's own explicit configuration, which IS the consent to read them.
//
// Known scope limit: only transcript-TOUCHED files gain beacons — target enumeration comes
// from extracted events, so a file that exists only in the base commit has no history to
// splice into. That matches the engine's charter (reconstruct the files the session touched).

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

// Deterministic changeId (item-34 scriptRun: precedent) so every replay of the same
// baseline agrees: gitBase:<hash>:<target>.
export function computeBaseCommitChangeId(baseCommit: Uuid, target: Path): Uuid {
    return new Uuid(`${BASE_COMMIT_CHANGE_ID_PREFIX}${baseCommit.toString()}:${target.toString()}`);
}

// The committer timestamp of <commit> in <repoDir> (git show -s --format=%cI), or
// undefined when the repo/commit is unreadable (silent-degradation channel semantics).
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

// The committed bytes of <relativePath> at <commit>, or undefined when absent
// (mirrors readCommittedFileContent's execSync + JSON.stringify quoting).
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

// The first record carrying a cwd — the recorded project root the repo layout is
// relative to.
export function findFirstRecordCwd(records: TranscriptRecord[]): Path | undefined {
    for (const record of records) {
        const cwd = (record as { cwd?: Path }).cwd;
        if (cwd !== undefined) {
            return cwd;
        }
    }
    return undefined;
}

// Reconstruction stage: when repoDir+baseCommit overrides are set and the commit's
// tree holds this target, splice a tier-1 WriteEvent of the committed bytes at the
// commit's timestamp. Every absence (no overrides, no recorded cwd, target outside
// the project root, unreadable commit, file not in commit) returns events unchanged.
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
        // A baseline IS recorded but its commit cannot be read — the configured repo moved or was
        // cleaned. Unlike the benign guards above (normal no-baseline sessions), this is missing
        // evidence, so it is noted for the wire document before the usual silent degradation.
        noteReconstructionFailure({ scope: FailureScope.fileStage, stage: "seedBaseCommitBeacon", target, reason: "git baseline commit unreadable (recorded repo missing)" });
        return events;
    }
    const content = readCommitFileContent(repoDir, baseCommit, relativePath);
    if (content === undefined) {
        return events;
    }
    const changeId = computeBaseCommitChangeId(baseCommit, target);
    const beacon: WriteEvent = { kind: EventKind.write, changeId, target, content, timestamp };
    // Insert before the first event strictly after the beacon's timestamp (end when none),
    // splicing into a COPY of the input.
    const followerIndex = events.findIndex((event) => event.timestamp.getTime() > timestamp.getTime());
    const insertionIndex = followerIndex === -1 ? events.length : followerIndex;
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

