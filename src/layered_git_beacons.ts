// Layer 2 commit beacons (task 200, spec S3): each commit touching a file contributes a
// verified BeaconNode carrying the commit's blob bytes at its COMMITTER instant (author time is
// never read — hpp Q7). Absence (no repo, path outside it, no blob at a commit) is a silent
// skip, the same posture as reconstruction_git_evidence.ts. Merging these onto session
// timelines is S5/task 202's job — this module only produces the nodes.

import { execSync } from "node:child_process";
import { relative } from "node:path";
import { Path } from "./structures/domain.ts";
import { LayeredNodeKind } from "./structures/vocabulary.ts";
import { widenCommitterSecondsToInstant } from "./layered_instants.ts";
import type { BeaconNode } from "./layered_types.ts";

// One commit that touched the target, on the shared axis.
interface CommitTouch {
    hash: string;
    committerEpochSeconds: number;
}

// The commits touching `cwdRelativePath` in `repoPath`, OLDEST first (timeline order). %ct is
// committer epoch seconds — the only time source this module reads. Empty on any git failure.
function listCommitsTouchingFile(repoPath: Path, cwdRelativePath: string): CommitTouch[] {
    let log: string;
    try {
        log = execSync(`git log --format="%H %ct" -- ${JSON.stringify(cwdRelativePath)}`, {
            cwd: repoPath.toString(),
            stdio: "pipe",
        }).toString();
    } catch {
        return [];
    }
    const touches: CommitTouch[] = [];
    for (const line of log.split("\n")) {
        const [hash, seconds] = line.split(" ");
        if (hash === undefined || seconds === undefined || hash === "") {
            continue;
        }
        touches.push({ hash, committerEpochSeconds: Number(seconds) });
    }
    return touches.reverse();
}

// The blob bytes of `cwdRelativePath` at `hash`, or undefined when the commit holds none (a
// commit that deleted the file still "touches" it but has no blob to beacon).
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

// The layer-2 beacons for one file: one node per commit whose tree holds the file, oldest
// first, instants widened from committer seconds. evidence stays undefined — a commit blob has
// no JSONL line to point at.
export function collectCommitBeaconNodes(repoPath: Path, filePath: Path): BeaconNode[] {
    const cwdRelativePath = relative(repoPath.toString(), filePath.toString());
    if (cwdRelativePath === "" || cwdRelativePath.startsWith("..")) {
        return [];
    }
    const beacons: BeaconNode[] = [];
    for (const touch of listCommitsTouchingFile(repoPath, cwdRelativePath)) {
        const content = readBlobAtCommit(repoPath, touch.hash, cwdRelativePath);
        if (content === undefined) {
            continue;
        }
        beacons.push({
            kind: LayeredNodeKind.beacon,
            instant: widenCommitterSecondsToInstant(touch.committerEpochSeconds),
            content,
            evidence: undefined,
        });
    }
    return beacons;
}
