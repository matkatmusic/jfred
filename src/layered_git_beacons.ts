// Produces one BeaconNode per commit blob at committer time (hpp Q7); merging onto timelines is S5's job.

import { execSync, spawnSync } from "node:child_process";
import { relative } from "node:path";
import { ACTIVE_BRANCH_REF } from "./layer1_repo_tree.ts";
import { Path } from "./structures/domain.ts";
import { LayeredNodeKind } from "./structures/vocabulary.ts";
import { widenEpochSecondsToInstant } from "./layered_instants.ts";
import type { BeaconNode } from "./layered_types.ts";

// Both author and committer stamps ride along (task 282); caller chooses which one to use.
export interface CommitTouch {
    hash: string;
    committerEpochSeconds: number;
    authorEpochSeconds: number;
}

// spawnSync array form (task 235) prevents shell injection when ref arrives from a URL.
export function listCommitsTouchingFile(repoPath: Path, repoRelativePath: Path, ref: string = ACTIVE_BRANCH_REF): CommitTouch[] {
    const result = spawnSync("git", ["log", ref, "--format=%H %ct %at", "--", repoRelativePath.toString()], {
        cwd: repoPath.toString(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        return [];
    }
    const touches: CommitTouch[] = [];
    for (const line of result.stdout.split("\n")) {
        const [hash, committerSeconds, authorSeconds] = line.split(" ");
        if (hash === undefined || committerSeconds === undefined || authorSeconds === undefined || hash === "") {
            continue;
        }
        touches.push({ hash, committerEpochSeconds: Number(committerSeconds), authorEpochSeconds: Number(authorSeconds) });
    }
    return touches.reverse();
}

// Returns undefined for delete-commits that touched the file but hold no blob.
function readBlobAtCommit(repoPath: Path, hash: string, cwdRelativePath: string): string | undefined {
    try {
        return execSync(`git show ${hash}:${JSON.stringify(cwdRelativePath)}`, {
            cwd: repoPath.toString(),
            stdio: "pipe",
        }).toString();
    } catch {
        return undefined;
    }
}

// Committer-ONLY by design: hpp Q7 pins beacons to committer time, not the task 282 toggle.
export function collectCommitBeaconNodes(repoPath: Path, filePath: Path): BeaconNode[] {
    const cwdRelativePath = relative(repoPath.toString(), filePath.toString());
    if (cwdRelativePath === "" || cwdRelativePath.startsWith("..")) {
        return [];
    }
    const beacons: BeaconNode[] = [];
    for (const touch of listCommitsTouchingFile(repoPath, new Path(cwdRelativePath))) {
        const content = readBlobAtCommit(repoPath, touch.hash, cwdRelativePath);
        if (content === undefined) {
            continue;
        }
        beacons.push({
            kind: LayeredNodeKind.beacon,
            instant: widenEpochSecondsToInstant(touch.committerEpochSeconds),
            content,
            evidence: undefined,
        });
    }
    return beacons;
}

