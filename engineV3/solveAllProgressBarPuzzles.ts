// The jot run: solve the progress bar puzzle of every file once, keep the answers in reconstruction-cache.json, and check later that solved files still solve.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { PuzzleFailureReason } from "../src/structures/vocabulary.ts";
import { listGitHopsForFile } from "./engineV3_file_git_hops.ts";
import { ABSENT_FILE_HASH, computeBytesHash, isProgressBarPuzzleSolved, type FullyReconstructibleFile, type Hop, type OnDiskFile, type ProgressBarPuzzle, type ReconstructionCache, type RequiresFurtherResearchFile } from "./engineV3_puzzle_types.ts";

// filesNotOnDiskNow: files the logs name that are gone from disk; they are solved too, with the absent hash, and listed here so the user sees them.
// filesWithHistoryCompleteInGit: files git deleted whose logs never change them after the delete commit; they need no reconstruction.
export interface ReconstructionCacheFile extends ReconstructionCache {
    filesNotOnDiskNow: Path[];
    filesWithHistoryCompleteInGit: Path[];
}

// allJSONLs are the jsonls FOLDERS; snapshotFolders are the file-history folders (snapshots are beacons).
export interface SolveAllArguments {
    allJSONLs: Path[];
    snapshotFolders: Path[];
    allFiles: Path[];
    filesWithHistoryCompleteInGit: Path[];
    gitRepo: Path;
    gitHash: string;
    cacheFile: Path;
    isCheckSolved: boolean;
}

export type TryToSolveProgressBarPuzzle = (onDiskFile: OnDiskFile, allJSONLs: Path[], gitRepo: Path, commitHash: string, snapshotFolders: Path[]) => ProgressBarPuzzle;

type JsonOnDiskFile = { file: string; hashNow: string };
type JsonHop = { jsonlHop?: { jsonlFile: string; lineNumber: number }; gitHop?: { repo: string; commit: string } };
type JsonCacheFile = {
    fullyReconstructibleFiles: { hops: JsonHop[]; onDiskFile: JsonOnDiskFile }[];
    requiresFurtherResearchFiles: { onDiskFile: JsonOnDiskFile; hops: JsonHop[]; lastAttemptedHop: { jsonlFile: string; lineNumber: number } | undefined; failureReason: PuzzleFailureReason; failureDetail: string | undefined }[];
    filesNotOnDiskNow: string[];
    filesWithHistoryCompleteInGit: string[];
};

// A file that is not on disk now gets the absent marker as its hash: its puzzle is solved when the replay ends with the file deleted.
export function buildOnDiskFile(file: Path): OnDiskFile {
    if (!existsSync(file.toString())) {
        return { file, hashNow: ABSENT_FILE_HASH };
    }
    return { file, hashNow: computeBytesHash(readFileSync(file.toString())) };
}

function convertHopsToJson(hops: Hop[]): JsonHop[] {
    return hops.map((hop) => {
        const jsonHop: JsonHop = {};
        if (hop.jsonlHop !== undefined) {
            jsonHop.jsonlHop = { jsonlFile: hop.jsonlHop.jsonlFile.toString(), lineNumber: hop.jsonlHop.lineNumber };
        }
        if (hop.gitHop !== undefined) {
            jsonHop.gitHop = { repo: hop.gitHop.repo.toString(), commit: hop.gitHop.commit };
        }
        return jsonHop;
    });
}

function convertHopsFromJson(jsonHops: JsonHop[]): Hop[] {
    return jsonHops.map((jsonHop) => {
        const hop: Hop = {};
        if (jsonHop.jsonlHop !== undefined) {
            hop.jsonlHop = { jsonlFile: new Path(jsonHop.jsonlHop.jsonlFile), lineNumber: jsonHop.jsonlHop.lineNumber };
        }
        if (jsonHop.gitHop !== undefined) {
            hop.gitHop = { repo: new Path(jsonHop.gitHop.repo), commit: jsonHop.gitHop.commit };
        }
        return hop;
    });
}

export function writeReconstructionCache(cacheFile: Path, cache: ReconstructionCacheFile): void {
    const json: JsonCacheFile = {
        fullyReconstructibleFiles: cache.fullyReconstructibleFiles.map((entry) => ({ hops: convertHopsToJson(entry.hops), onDiskFile: { file: entry.onDiskFile.file.toString(), hashNow: entry.onDiskFile.hashNow } })),
        requiresFurtherResearchFiles: cache.requiresFurtherResearchFiles.map((entry) => ({
            onDiskFile: { file: entry.onDiskFile.file.toString(), hashNow: entry.onDiskFile.hashNow },
            hops: convertHopsToJson(entry.hops),
            lastAttemptedHop: entry.lastAttemptedHop === undefined ? undefined : { jsonlFile: entry.lastAttemptedHop.jsonlFile.toString(), lineNumber: entry.lastAttemptedHop.lineNumber },
            failureReason: entry.failureReason,
            failureDetail: entry.failureDetail,
        })),
        filesNotOnDiskNow: cache.filesNotOnDiskNow.map((file) => file.toString()),
        filesWithHistoryCompleteInGit: cache.filesWithHistoryCompleteInGit.map((file) => file.toString()),
    };
    const temporaryFile = `${cacheFile.toString()}.tmp`;
    mkdirSync(dirname(cacheFile.toString()), { recursive: true });
    writeFileSync(temporaryFile, JSON.stringify(json, null, 2));
    renameSync(temporaryFile, cacheFile.toString());
}

// A missing cache file is the first run: three empty lists.
export function readReconstructionCache(cacheFile: Path): ReconstructionCacheFile {
    if (!existsSync(cacheFile.toString())) {
        return { fullyReconstructibleFiles: [], requiresFurtherResearchFiles: [], filesNotOnDiskNow: [], filesWithHistoryCompleteInGit: [] };
    }
    const json = JSON.parse(readFileSync(cacheFile.toString(), "utf8")) as JsonCacheFile;
    return {
        fullyReconstructibleFiles: json.fullyReconstructibleFiles.map((entry) => ({ hops: convertHopsFromJson(entry.hops), onDiskFile: { file: new Path(entry.onDiskFile.file), hashNow: entry.onDiskFile.hashNow } })),
        requiresFurtherResearchFiles: json.requiresFurtherResearchFiles.map((entry) => ({
            onDiskFile: { file: new Path(entry.onDiskFile.file), hashNow: entry.onDiskFile.hashNow },
            hops: convertHopsFromJson(entry.hops),
            lastAttemptedHop: entry.lastAttemptedHop === undefined ? undefined : { jsonlFile: new Path(entry.lastAttemptedHop.jsonlFile), lineNumber: entry.lastAttemptedHop.lineNumber },
            failureReason: entry.failureReason,
            failureDetail: entry.failureDetail,
        })),
        filesNotOnDiskNow: json.filesNotOnDiskNow.map((file) => new Path(file)),
        filesWithHistoryCompleteInGit: json.filesWithHistoryCompleteInGit.map((file) => new Path(file)),
    };
}

function getCommitInstant(repo: Path, commit: string): Date {
    return new Date(execFileSync("git", ["-C", repo.toString(), "show", "-s", "--format=%cI", commit], { encoding: "utf8" }).trim());
}

// True when the file is absent on disk now, its last git hop is a delete, and no log event changes it after that delete commit. latestEventInstant is undefined when no log event changes the file.
export function isHistoryCompleteInGit(repo: Path, file: Path, latestEventInstant: Date | undefined): boolean {
    if (existsSync(file.toString())) {
        return false;
    }
    // A session scratchpad file lies outside the repo: git holds no history for it.
    if (relative(repo.toString(), file.toString()).startsWith("..")) {
        return false;
    }
    const gitHops = listGitHopsForFile(repo, file);
    if (gitHops.length === 0) {
        return false;
    }
    const lastGitHop = gitHops[gitHops.length - 1]!;
    if (!lastGitHop.isDelete) {
        return false;
    }
    if (latestEventInstant === undefined) {
        return true;
    }
    return latestEventInstant.getTime() <= getCommitInstant(repo, lastGitHop.commit).getTime();
}

// All files minus the solved ones, plus the research files that all files misses.
export function listFilesToSolve(allFiles: Path[], cache: ReconstructionCache): Path[] {
    const solvedFileTexts = new Set(cache.fullyReconstructibleFiles.map((entry) => entry.onDiskFile.file.toString()));
    const filesToSolve = allFiles.filter((file) => !solvedFileTexts.has(file.toString()));
    const listedFileTexts = new Set(filesToSolve.map((file) => file.toString()));
    for (const researchFile of cache.requiresFurtherResearchFiles) {
        if (!listedFileTexts.has(researchFile.onDiskFile.file.toString())) {
            filesToSolve.push(researchFile.onDiskFile.file);
            listedFileTexts.add(researchFile.onDiskFile.file.toString());
        }
    }
    return filesToSolve;
}

export function recordPuzzleResult(cache: ReconstructionCacheFile, puzzle: ProgressBarPuzzle): ReconstructionCacheFile {
    const fileText = puzzle.file.file.toString();
    const researchFilesOfOtherFiles = cache.requiresFurtherResearchFiles.filter((entry) => entry.onDiskFile.file.toString() !== fileText);
    if (isProgressBarPuzzleSolved(puzzle)) {
        const solvedFile: FullyReconstructibleFile = { hops: puzzle.hops, onDiskFile: puzzle.file };
        const otherSolvedFiles = cache.fullyReconstructibleFiles.filter((entry) => entry.onDiskFile.file.toString() !== fileText);
        return { ...cache, fullyReconstructibleFiles: [...otherSolvedFiles, solvedFile], requiresFurtherResearchFiles: researchFilesOfOtherFiles };
    }
    if (puzzle.failureReason === undefined) {
        throw new Error(`${fileText} is unsolved but the puzzle has no failure reason`);
    }
    const researchFile: RequiresFurtherResearchFile = { onDiskFile: puzzle.file, hops: puzzle.hops, lastAttemptedHop: puzzle.lastAttemptedHop, failureReason: puzzle.failureReason, failureDetail: puzzle.failureDetail };
    return { ...cache, requiresFurtherResearchFiles: [...researchFilesOfOtherFiles, researchFile] };
}

function checkSolvedFilesStillReconstruct(cliArgs: SolveAllArguments, tryToSolve: TryToSolveProgressBarPuzzle, reportProgress: (line: string) => void): ReconstructionCacheFile {
    const cache = readReconstructionCache(cliArgs.cacheFile);
    for (const [index, solvedFile] of cache.fullyReconstructibleFiles.entries()) {
        const puzzle = tryToSolve(solvedFile.onDiskFile, cliArgs.allJSONLs, cliArgs.gitRepo, cliArgs.gitHash, cliArgs.snapshotFolders);
        if (!isProgressBarPuzzleSolved(puzzle)) {
            throw new Error(`codebase changes caused a regression and now ${solvedFile.onDiskFile.file.toString()} doesn't fully reconstruct!!`);
        }
        reportProgress(`${index + 1}/${cache.fullyReconstructibleFiles.length} ${solvedFile.onDiskFile.file.toString()} still solved`);
    }
    return cache;
}

// The user's shape: read the cache, list the files to solve, solve each, write the cache. The cache file is rewritten after each file, so a stopped run keeps its answers.
export function tryToReconstructAllFiles(cliArgs: SolveAllArguments, tryToSolve: TryToSolveProgressBarPuzzle, reportProgress: (line: string) => void): ReconstructionCacheFile {
    if (cliArgs.isCheckSolved) {
        return checkSolvedFilesStillReconstruct(cliArgs, tryToSolve, reportProgress);
    }
    let cache = readReconstructionCache(cliArgs.cacheFile);
    const completeFileTexts = new Set(cliArgs.filesWithHistoryCompleteInGit.map((file) => file.toString()));
    const filesToReconstruct = cliArgs.allFiles.filter((file) => !completeFileTexts.has(file.toString()));
    const filesNotOnDiskNow = filesToReconstruct.filter((file) => !existsSync(file.toString()));
    cache = { ...cache, filesNotOnDiskNow, filesWithHistoryCompleteInGit: cliArgs.filesWithHistoryCompleteInGit };
    // const filesToSolve = listFilesToSolve(cliArgs.allFiles.filter((file) => existsSync(file.toString())), cache);
    const filesToSolve = listFilesToSolve(filesToReconstruct, cache);
    for (const [index, file] of filesToSolve.entries()) {
        const puzzle = tryToSolve(buildOnDiskFile(file), cliArgs.allJSONLs, cliArgs.gitRepo, cliArgs.gitHash, cliArgs.snapshotFolders);
        cache = recordPuzzleResult(cache, puzzle);
        writeReconstructionCache(cliArgs.cacheFile, cache);
        const resultText = isProgressBarPuzzleSolved(puzzle) ? "solved" : puzzle.failureReason;
        reportProgress(`${index + 1}/${filesToSolve.length} ${file.toString()} ${resultText}`);
    }
    writeReconstructionCache(cliArgs.cacheFile, cache);
    reportProgress(`${filesNotOnDiskNow.length} files not on disk now`);
    reportProgress(`${cliArgs.filesWithHistoryCompleteInGit.length} files with history complete in git`);
    return cache;
}
