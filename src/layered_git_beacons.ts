// Layer 2 commit beacons (task 200, spec S3): each commit touching a file contributes a
// verified BeaconNode carrying the commit's blob bytes at its COMMITTER instant (author time is
// never read — hpp Q7). Absence (no repo, path outside it, no blob at a commit) is a silent
// skip, the same posture as reconstruction_git_evidence.ts. Merging these onto session
// timelines is S5/task 202's job — this module only produces the nodes.

import { execSync, spawnSync } from "node:child_process";
import { relative } from "node:path";
import { ACTIVE_BRANCH_REF } from "./layer1_repo_tree.ts";
import { Path } from "./structures/domain.ts";
import { LayeredNodeKind } from "./structures/vocabulary.ts";
import { widenEpochSecondsToInstant } from "./layered_instants.ts";
import type { BeaconNode } from "./layered_types.ts";

// One commit that touched the target, on the shared axis. BOTH stamps ride along (task 282); which
// one places the commit is the caller's choice, not this module's.
export interface CommitTouch {
    hash: string;
    committerEpochSeconds: number;
    authorEpochSeconds: number;
}

// The commits touching `repoRelativePath` in `repoPath` reachable from `ref` (default: the active
// branch), OLDEST first (timeline order). %ct is committer epoch seconds and %at author seconds;
// both are returned by the ONE spawn so flipping task 282's toggle never re-runs git (a full Layer
// 1 build is ~10 s). No `--follow`: rename tracking is S6's job, so a renamed file simply shows
// the shorter history. Empty on any git failure. Shared with Layer 1's per-pair history (task 233,
// layer1_commit_history.ts) so there is exactly one git-log reader in the engine.
//
// spawnSync in ARGUMENT-ARRAY form, not an execSync template (task 235): `ref` now arrives from a
// URL, and inside execSync's double quotes `$(…)`/backticks would still execute — the array form
// removes the shell entirely, needs no quoting dance, and lets maxBuffer be raised past
// execSync's 1 MB default, which a long history would otherwise trip into a false "no commits".
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
// Deliberately committer-ONLY: task 282's author/committer toggle is a LAYER 1 view choice, while
// hpp Q7 pins layer 2's beacons to committer time. Do not "fix" this to follow the toggle.
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
