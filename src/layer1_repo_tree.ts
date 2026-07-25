// Task 231 (spec S18): the `starting repository state` — every file tracked at a ref, as a
// path RELATIVE to the repo root. Layer 1 reads no JSONL; this is one git plumbing call.
// Posture differs from layered_git_beacons.ts, which swallows git failures: a ref the user
// typed is an input, so a bad one must be a loud error, never a silent fall back to HEAD.

import { spawnSync } from "node:child_process";
import { Path } from "./structures/domain.ts";

// The default ref: HEAD already IS the repo's active branch, so no separate branch lookup. The
// engine's ONE canonical "HEAD" — layered_git_beacons.ts and layer1_commit_history.ts import it
// from here rather than re-spelling the string (coding-requirements §2).
export const ACTIVE_BRANCH_REF = "HEAD";

// The tracked paths in `repoDir` at `ref`, relative to the repo root, in git's tree order.
// Throws when the ref does not resolve (or the directory is not a repo), naming the ref.
export function listRepoTreeAtRef(repoDir: Path, ref: string = ACTIVE_BRANCH_REF): Path[] {
    // -z keeps paths raw (git C-quotes spaces/unicode without it); the argument array means
    // the ref never reaches a shell, so no validation regex or quoting dance is needed.
    const result = spawnSync("git", ["ls-tree", "-r", "--name-only", "-z", ref, "--"], {
        cwd: repoDir.toString(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`git ls-tree failed for ref "${ref}" in ${repoDir.toString()}: ${result.stderr ?? result.error?.message ?? ""}`.trim());
    }
    return result.stdout.split("\0").filter((line) => line !== "").map((line) => new Path(line));
}
