// Evidence channel: reads committed/staged bytes from on-disk repos by timestamp.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { getRecordSource } from "./parse/loadTranscript.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// Commits land seconds after the Bash record; distinct commits sit minutes apart.
const COMMIT_MATCH_TOLERANCE_MS = 60_000;

// Nearest commit by committer time, within tolerance.
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

// File bytes at a commit; tries fallback repo dirs when the recorded cwd decayed.
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

// Staged blob via `git ls-files --stage` then `git cat-file -p`.
function readIndexBlob(repoDir: Path, cwdRelativePath: string): string | undefined {
    try {
        const stageLine = execSync(`git ls-files --stage -- ${JSON.stringify(cwdRelativePath)}`, {
            cwd: repoDir.toString(),
            stdio: "pipe",
        }).toString();
        const hash = stageLine.split(/\s+/)[1];
        if (hash === undefined) return undefined;
        if (hash === "") return undefined;
        return execSync(`git cat-file -p ${hash}`, { cwd: repoDir.toString(), stdio: "pipe" }).toString();
    } catch {
        return undefined;
    }
}

// Index blob from `git add` — sole evidence when no commit followed.
export function readStagedFileContent(
    repoCwd: Path,
    filePath: Path,
    fallbackRepoDirs: Path[] = [],
): string | undefined {
    const cwdRelativePath = relative(repoCwd.toString(), filePath.toString());
    if (cwdRelativePath === "" || cwdRelativePath.startsWith("..")) return undefined;
    for (const repoDir of [repoCwd, ...fallbackRepoDirs]) {
        const content = readIndexBlob(repoDir, cwdRelativePath);
        if (content !== undefined) return content;
    }
    return undefined;
}

// Transcript-sibling preserved repo clone, if present.
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

// Fallback repo dirs: configured overrides then transcript-sibling clone.
export function findFallbackRepoDirs(records: TranscriptRecord[]): Path[] {
    const candidates = [getPathOverrides().repoDir, getPathOverrides().projectCwd, findPreservedRepoDir(records)];
    return candidates.filter((dir): dir is Path => dir !== undefined);
}
