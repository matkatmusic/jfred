// Git-commit blobs as an evidence channel: a transcript records `git commit` commands (with cwd and
// timestamps) but not the committed content. When the repo still exists on disk, the commit resolved
// by timestamp yields the committed bytes — evidence for content no other channel carries (s85's
// out-of-band `# reviewed by ops` comment exists ONLY in its `post-rename` commit).

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { getRecordSource } from "./parse/loadTranscript.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// How far a repo's commit time may sit from the record's command time and still be "that commit"
// (the commit lands a couple of seconds after the Bash record; distinct commits sit minutes apart).
const COMMIT_MATCH_TOLERANCE_MS = 60_000;

// The commit hash in `repoCwd` whose committer time is nearest `commitTimestamp` (within tolerance),
// or undefined when the repo is absent or no commit is near enough.
function resolveCommitByTimestamp(repoCwd: Path, commitTimestamp: Date): string | undefined {
    let log: string;
    try {
        log = execSync("git log --format='%H %cI'", { cwd: repoCwd.toString(), stdio: "pipe" }).toString();
    } catch {
        return undefined;
    }
    let bestHash: string | undefined;
    let bestDistance = COMMIT_MATCH_TOLERANCE_MS;
    for (const line of log.split("\n")) {
        const [hash, committedAt] = line.split(" ");
        if (hash === undefined || committedAt === undefined) continue;
        const distance = Math.abs(new Date(committedAt).getTime() - commitTimestamp.getTime());
        if (distance <= bestDistance) {
            bestDistance = distance;
            bestHash = hash;
        }
    }
    return bestHash;
}

// The committed bytes of `filePath` at the commit recorded at `commitTimestamp` in `repoCwd`, or
// undefined when the repo, the commit, or the path is absent — absence is a silent no-op so every
// non-git scenario is untouched. When the recorded cwd's repo has decayed (macOS purges idle temp
// files after ~3 days), each of `fallbackRepoDirs` — mirrors of the recorded repo's layout at
// other disk locations (configured overrides, the transcript-sibling preserved clone) — is
// consulted in order with the SAME cwd-relative path (item 46).
// The bytes of `cwdRelativePath` at commit `hash` in `repoDir`, or undefined when `git show` fails.
function readFileContentAtCommit(repoDir: Path, hash: string, cwdRelativePath: string): string | undefined {
    try {
        return execSync(`git show ${hash}:${JSON.stringify(cwdRelativePath)}`, {
            cwd: repoDir.toString(),
            stdio: "pipe",
        }).toString();
    } catch {
        return undefined;
    }
}

export function readCommittedFileContent(
    repoCwd: Path,
    commitTimestamp: Date,
    filePath: Path,
    // item 46: preservedRepoDir?: Path,
    fallbackRepoDirs: Path[] = [],
): string | undefined {
    const cwdRelativePath = relative(repoCwd.toString(), filePath.toString());
    if (cwdRelativePath === "" || cwdRelativePath.startsWith("..")) return undefined;
    // item 46: const repoDirs = preservedRepoDir === undefined ? [repoCwd] : [repoCwd, preservedRepoDir];
    const repoDirs = [repoCwd, ...fallbackRepoDirs];
    for (const repoDir of repoDirs) {
        const hash = resolveCommitByTimestamp(repoDir, commitTimestamp);
        if (hash === undefined) continue;
        const content = readFileContentAtCommit(repoDir, hash, cwdRelativePath);
        if (content !== undefined) return content;
    }
    return undefined;
}

// The directory the records' transcript was loaded from, when it carries a git repo — scenario
// captures preserve a clone of the recorded repo next to the transcript, which outlives the
// recorded temp cwd. Undefined for records without a source or a repo (live viewer transcripts
// sit in ~/.claude/projects, which is not a repo).
function findPreservedRepoDir(records: TranscriptRecord[]): Path | undefined {
    for (const record of records) {
        const source = getRecordSource(record);
        if (source === undefined) continue;
        const transcriptDir = dirname(source.filePath);
        if (!existsSync(join(transcriptDir, ".git"))) return undefined;
        return new Path(transcriptDir);
    }
    return undefined;
}

// Every fallback repo dir to try after the recorded cwd, most-explicit first: the configured
// repoDir override, the configured projectCwd (the project's current disk location often
// contains the repo), then the transcript-sibling preserved clone (item 46). Empty overrides
// reduce this to the old preserved-dir singleton.
export function findFallbackRepoDirs(records: TranscriptRecord[]): Path[] {
    const candidates = [getPathOverrides().repoDir, getPathOverrides().projectCwd, findPreservedRepoDir(records)];
    return candidates.filter((dir): dir is Path => dir !== undefined);
}
