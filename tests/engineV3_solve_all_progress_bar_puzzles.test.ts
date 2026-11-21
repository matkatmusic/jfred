// The jot run: solve the progress bar puzzle of every file once, keep the answers in reconstruction-cache.json, and check later that solved files still solve.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { PuzzleFailureReason } from "../src/structures/vocabulary.ts";
import { ABSENT_FILE_HASH, computeBytesHash, type FullyReconstructibleFile, type Hop, type OnDiskFile, type ProgressBarPuzzle, type RequiresFurtherResearchFile } from "../engineV3/engineV3_puzzle_types.ts";
import {
    buildOnDiskFile,
    isHistoryCompleteInGit,
    listFilesToSolve,
    readReconstructionCache,
    recordPuzzleResult,
    tryToReconstructAllFiles,
    writeReconstructionCache,
    type ReconstructionCacheFile,
    type SolveAllArguments,
    type TryToSolveProgressBarPuzzle,
} from "../engineV3/solveAllProgressBarPuzzles.ts";

const GIT_REPO = new Path("/repo/jot.git");
const GIT_HASH = "793e65241902f276caf5f5c28d539269e7d36d11";
const JSONL_HOP = { jsonlFile: new Path("/logs/a.jsonl"), lineNumber: 3 };

function makeScratchFolder(): string {
    return mkdtempSync(join(tmpdir(), "solve-all-"));
}

function makeFileOnDisk(folder: string, name: string, text: string): OnDiskFile {
    const file = new Path(join(folder, name));
    writeFileSync(file.toString(), text);
    return buildOnDiskFile(file);
}

function makeFullyReconstructibleFile(onDiskFile: OnDiskFile): FullyReconstructibleFile {
    return { hops: [{ jsonlHop: JSONL_HOP }], onDiskFile };
}

function makeRequiresFurtherResearchFile(onDiskFile: OnDiskFile): RequiresFurtherResearchFile {
    return { onDiskFile, hops: [{ jsonlHop: JSONL_HOP }], lastAttemptedHop: JSONL_HOP, failureReason: PuzzleFailureReason.FinalHashMismatch, failureDetail: undefined };
}

function makeCache(fullyReconstructibleFiles: FullyReconstructibleFile[], requiresFurtherResearchFiles: RequiresFurtherResearchFile[], filesNotOnDiskNow: Path[] = [], filesWithHistoryCompleteInGit: Path[] = []): ReconstructionCacheFile {
    return { fullyReconstructibleFiles, requiresFurtherResearchFiles, filesNotOnDiskNow, filesWithHistoryCompleteInGit };
}

// A real git repo in a scratch folder. The commits carry the given dates, so the tests control the commit times.
function runGit(repoFolder: string, gitArguments: string[], commitDate: string): void {
    execFileSync("git", ["-C", repoFolder, ...gitArguments], { env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
}

function makeRepoWithDeletedFile(): { repo: Path; file: Path } {
    const repoFolder = makeScratchFolder();
    const file = new Path(join(repoFolder, "gone.txt"));
    runGit(repoFolder, ["init", "-q"], "2026-01-01T00:00:00Z");
    runGit(repoFolder, ["config", "user.email", "test@example.com"], "2026-01-01T00:00:00Z");
    runGit(repoFolder, ["config", "user.name", "Test"], "2026-01-01T00:00:00Z");
    writeFileSync(file.toString(), "text");
    runGit(repoFolder, ["add", "gone.txt"], "2026-01-01T00:00:00Z");
    runGit(repoFolder, ["commit", "-q", "-m", "add"], "2026-01-02T00:00:00Z");
    runGit(repoFolder, ["rm", "-q", "gone.txt"], "2026-01-03T00:00:00Z");
    runGit(repoFolder, ["commit", "-q", "-m", "delete"], "2026-01-03T00:00:00Z");
    return { repo: new Path(repoFolder), file };
}

function makePuzzle(onDiskFile: OnDiskFile, isSolved: boolean, hops: Hop[] = [{ jsonlHop: JSONL_HOP }]): ProgressBarPuzzle {
    const bytes = isSolved && onDiskFile.hashNow !== ABSENT_FILE_HASH ? readFileSync(onDiskFile.file.toString(), "utf8") : "wrong bytes";
    return { file: onDiskFile, hops, bytes, lastAttemptedHop: JSONL_HOP, failureReason: isSolved ? undefined : PuzzleFailureReason.FinalHashMismatch, failureDetail: undefined };
}

function makeSolveAllArguments(folder: string, allFiles: Path[], isCheckSolved = false, filesWithHistoryCompleteInGit: Path[] = []): SolveAllArguments {
    return { allJSONLs: [new Path("/logs")], snapshotFolders: [new Path("/history")], allFiles, filesWithHistoryCompleteInGit, gitRepo: GIT_REPO, gitHash: GIT_HASH, cacheFile: new Path(join(folder, "reconstruction-cache.json")), isCheckSolved };
}

// A stub solver: the files named in solvableNames solve, all others fail. It records the file names it was asked for.
function makeStubSolver(solvableNames: string[], askedFileNames: string[]): TryToSolveProgressBarPuzzle {
    return (onDiskFile) => {
        askedFileNames.push(onDiskFile.file.toString());
        const isSolved = solvableNames.some((name) => onDiskFile.file.toString().endsWith(name));
        return makePuzzle(onDiskFile, isSolved);
    };
}

test("test_buildOnDiskFile_hashes_the_bytes_of_the_file", () => {
    // Scenario: a file that holds the text "abc".
    const onDiskFile = makeFileOnDisk(makeScratchFolder(), "a.txt", "abc");
    // the hash is the sha256 hex of "abc".
    assert.equal(onDiskFile.hashNow, computeBytesHash("abc"));
});

test("test_readReconstructionCache_of_a_missing_file_gives_three_empty_lists", () => {
    // Scenario: no cache file exists yet.
    const cache = readReconstructionCache(new Path(join(makeScratchFolder(), "reconstruction-cache.json")));
    // all three lists are empty.
    assert.deepEqual(cache, makeCache([], []));
});

test("test_a_written_cache_reads_back_the_same", () => {
    // Scenario: a cache with one solved file, one file that needs research, and one file that is not on disk now.
    const folder = makeScratchFolder();
    const cache = makeCache(
        [makeFullyReconstructibleFile(makeFileOnDisk(folder, "a.txt", "a"))],
        [makeRequiresFurtherResearchFile(makeFileOnDisk(folder, "b.txt", "b"))],
        [new Path(join(folder, "gone.txt"))],
        [new Path(join(folder, "deleted-by-git.txt"))],
    );
    const cacheFile = new Path(join(folder, "reconstruction-cache.json"));
    writeReconstructionCache(cacheFile, cache);
    // reading the file gives an equal cache, with Path objects in the hops.
    assert.deepEqual(readReconstructionCache(cacheFile), cache);
});

test("test_listFilesToSolve_drops_the_files_that_are_already_solved", () => {
    // Scenario: a.txt is solved; b.txt is not known.
    const folder = makeScratchFolder();
    const solvedFile = makeFileOnDisk(folder, "a.txt", "a");
    const cache = makeCache([makeFullyReconstructibleFile(solvedFile)], []);
    const filesToSolve = listFilesToSolve([solvedFile.file, new Path(join(folder, "b.txt"))], cache);
    // only b.txt stays.
    assert.deepEqual(filesToSolve.map(String), [join(folder, "b.txt")]);
});

test("test_listFilesToSolve_adds_a_research_file_that_all_files_misses", () => {
    // Scenario: c.txt needs research but the log list does not name it.
    const folder = makeScratchFolder();
    const researchFile = makeFileOnDisk(folder, "c.txt", "c");
    const cache = makeCache([], [makeRequiresFurtherResearchFile(researchFile)]);
    const filesToSolve = listFilesToSolve([new Path(join(folder, "b.txt"))], cache);
    // b.txt and c.txt are both listed.
    assert.deepEqual(filesToSolve.map(String), [join(folder, "b.txt"), join(folder, "c.txt")]);
});

test("test_a_research_file_that_all_files_names_is_listed_once", () => {
    // Scenario: c.txt needs research and the log list names it.
    const folder = makeScratchFolder();
    const researchFile = makeFileOnDisk(folder, "c.txt", "c");
    const cache = makeCache([], [makeRequiresFurtherResearchFile(researchFile)]);
    const filesToSolve = listFilesToSolve([researchFile.file], cache);
    // c.txt appears once.
    assert.deepEqual(filesToSolve.map(String), [join(folder, "c.txt")]);
});

test("test_a_solved_puzzle_becomes_a_fully_reconstructible_file_and_leaves_the_research_list", () => {
    // Scenario: c.txt needed research and now solves.
    const folder = makeScratchFolder();
    const onDiskFile = makeFileOnDisk(folder, "c.txt", "c");
    const cache = makeCache([], [makeRequiresFurtherResearchFile(onDiskFile)]);
    const nextCache = recordPuzzleResult(cache, makePuzzle(onDiskFile, true));
    // the research list is empty and the solved list holds c.txt with the hops of the puzzle.
    assert.deepEqual(nextCache.requiresFurtherResearchFiles, []);
    assert.deepEqual(nextCache.fullyReconstructibleFiles, [makeFullyReconstructibleFile(onDiskFile)]);
});

test("test_an_unsolved_puzzle_becomes_a_research_file_with_its_reason_and_last_attempted_hop", () => {
    // Scenario: b.txt fails, and its hops end in a git hop after a JSONL hop.
    const folder = makeScratchFolder();
    const onDiskFile = makeFileOnDisk(folder, "b.txt", "b");
    const hops = [{ jsonlHop: JSONL_HOP }, { gitHop: { repo: GIT_REPO, commit: GIT_HASH } }];
    const nextCache = recordPuzzleResult(makeCache([], []), makePuzzle(onDiskFile, false, hops));
    // the research list holds b.txt with the final hash mismatch reason and the JSONL hop of the puzzle as the last attempted hop.
    assert.deepEqual(nextCache.requiresFurtherResearchFiles, [{ onDiskFile, hops, lastAttemptedHop: JSONL_HOP, failureReason: PuzzleFailureReason.FinalHashMismatch, failureDetail: undefined }]);
});

test("test_an_unsolved_puzzle_without_a_last_attempted_hop_keeps_it_undefined", () => {
    // Scenario: b.txt fails before any JSONL hop (for example born after the start).
    const onDiskFile = makeFileOnDisk(makeScratchFolder(), "b.txt", "b");
    const nextCache = recordPuzzleResult(makeCache([], []), { ...makePuzzle(onDiskFile, false, []), lastAttemptedHop: undefined });
    // the research entry holds an undefined last attempted hop.
    assert.equal(nextCache.requiresFurtherResearchFiles[0]!.lastAttemptedHop, undefined);
});

test("test_an_unsolved_puzzle_replaces_the_older_research_entry_of_the_same_file", () => {
    // Scenario: b.txt already needs research for another reason, and fails again.
    const folder = makeScratchFolder();
    const onDiskFile = makeFileOnDisk(folder, "b.txt", "b");
    const olderEntry = { ...makeRequiresFurtherResearchFile(onDiskFile), failureReason: PuzzleFailureReason.NoEvents };
    const nextCache = recordPuzzleResult(makeCache([], [olderEntry]), makePuzzle(onDiskFile, false));
    // one entry stays, with the new reason.
    assert.equal(nextCache.requiresFurtherResearchFiles.length, 1);
    assert.equal(nextCache.requiresFurtherResearchFiles[0]!.failureReason, PuzzleFailureReason.FinalHashMismatch);
});

test("test_an_unsolved_puzzle_without_a_failure_reason_throws", () => {
    // Scenario: a puzzle whose bytes are wrong but whose failure reason is undefined.
    const onDiskFile = makeFileOnDisk(makeScratchFolder(), "b.txt", "b");
    const puzzle = { ...makePuzzle(onDiskFile, false), failureReason: undefined };
    assert.throws(() => recordPuzzleResult(makeCache([], []), puzzle), /no failure reason/);
});

test("test_tryToReconstructAllFiles_solves_each_unsolved_file_once_and_skips_solved_files", () => {
    // Scenario: a.txt is solved already in the cache file; b.txt solves; c.txt fails.
    const folder = makeScratchFolder();
    const solvedFile = makeFileOnDisk(folder, "a.txt", "a");
    const secondFile = makeFileOnDisk(folder, "b.txt", "b");
    const thirdFile = makeFileOnDisk(folder, "c.txt", "c");
    const args = makeSolveAllArguments(folder, [solvedFile.file, secondFile.file, thirdFile.file]);
    writeReconstructionCache(args.cacheFile, makeCache([makeFullyReconstructibleFile(solvedFile)], []));
    const askedFileNames: string[] = [];
    const cache = tryToReconstructAllFiles(args, makeStubSolver(["b.txt"], askedFileNames), () => {});
    // the solver was asked for b.txt and c.txt only.
    assert.deepEqual(askedFileNames, [secondFile.file.toString(), thirdFile.file.toString()]);
    // a.txt and b.txt are solved; c.txt needs research.
    assert.deepEqual(cache.fullyReconstructibleFiles.map((entry) => entry.onDiskFile.file.toString()), [solvedFile.file.toString(), secondFile.file.toString()]);
    assert.deepEqual(cache.requiresFurtherResearchFiles.map((entry) => entry.onDiskFile.file.toString()), [thirdFile.file.toString()]);
});

test("test_tryToReconstructAllFiles_writes_the_cache_file", () => {
    // Scenario: one file that solves.
    const folder = makeScratchFolder();
    const onDiskFile = makeFileOnDisk(folder, "b.txt", "b");
    const args = makeSolveAllArguments(folder, [onDiskFile.file]);
    const cache = tryToReconstructAllFiles(args, makeStubSolver(["b.txt"], []), () => {});
    // the file on disk reads back as the returned cache.
    assert.deepEqual(readReconstructionCache(args.cacheFile), cache);
});

test("test_tryToReconstructAllFiles_prints_one_progress_line_per_file", () => {
    // Scenario: two files to solve, one solves and one fails.
    const folder = makeScratchFolder();
    const firstFile = makeFileOnDisk(folder, "b.txt", "b");
    const secondFile = makeFileOnDisk(folder, "c.txt", "c");
    const progressLines: string[] = [];
    tryToReconstructAllFiles(makeSolveAllArguments(folder, [firstFile.file, secondFile.file]), makeStubSolver(["b.txt"], []), (line) => progressLines.push(line));
    // two file lines, each with the position, the file, and the result, then one summary line.
    assert.match(progressLines[0]!, /^1\/2 .*b\.txt solved$/);
    assert.match(progressLines[1]!, /^2\/2 .*c\.txt final-hash-mismatch$/);
});

test("test_buildOnDiskFile_of_a_file_that_is_not_on_disk_has_the_absent_hash", () => {
    // Scenario: gone.txt does not exist.
    const onDiskFile = buildOnDiskFile(new Path(join(makeScratchFolder(), "gone.txt")));
    // the hash is the fixed marker for absent.
    assert.equal(onDiskFile.hashNow, ABSENT_FILE_HASH);
});

test("test_a_file_that_is_not_on_disk_now_is_solved_too_listed_in_the_cache_and_counted_in_the_last_line", () => {
    // Scenario: gone.txt is named in the logs but does not exist; b.txt exists and solves.
    const folder = makeScratchFolder();
    const onDiskFile = makeFileOnDisk(folder, "b.txt", "b");
    const goneFile = new Path(join(folder, "gone.txt"));
    const args = makeSolveAllArguments(folder, [goneFile, onDiskFile.file]);
    const progressLines: string[] = [];
    const askedFileNames: string[] = [];
    const cache = tryToReconstructAllFiles(args, makeStubSolver(["b.txt"], askedFileNames), (line) => progressLines.push(line));
    // the solver is asked for gone.txt with the absent hash; the cache lists it under filesNotOnDiskNow; the last progress line gives the count.
    assert.deepEqual(askedFileNames, [goneFile.toString(), onDiskFile.file.toString()]);
    assert.equal(cache.requiresFurtherResearchFiles[0]!.onDiskFile.hashNow, ABSENT_FILE_HASH);
    assert.deepEqual(cache.filesNotOnDiskNow.map(String), [goneFile.toString()]);
    assert.ok(progressLines.includes("1 files not on disk now"));
});

test("test_files_with_history_complete_in_git_are_not_solved_and_are_listed_in_the_cache_and_counted_in_the_last_line", () => {
    // Scenario: deleted.txt is gone and git deleted it; b.txt exists and solves.
    const folder = makeScratchFolder();
    const onDiskFile = makeFileOnDisk(folder, "b.txt", "b");
    const deletedFile = new Path(join(folder, "deleted.txt"));
    const args = makeSolveAllArguments(folder, [deletedFile, onDiskFile.file], false, [deletedFile]);
    const progressLines: string[] = [];
    const askedFileNames: string[] = [];
    const cache = tryToReconstructAllFiles(args, makeStubSolver(["b.txt"], askedFileNames), (line) => progressLines.push(line));
    // the solver never sees deleted.txt; the cache lists it; it is not counted as not on disk; the last progress line gives its count.
    assert.deepEqual(askedFileNames, [onDiskFile.file.toString()]);
    assert.deepEqual(cache.filesWithHistoryCompleteInGit.map(String), [deletedFile.toString()]);
    assert.deepEqual(cache.filesNotOnDiskNow, []);
    assert.equal(progressLines[progressLines.length - 1], "1 files with history complete in git");
});

test("test_isHistoryCompleteInGit_is_true_for_a_file_that_git_deleted_with_no_later_log_event", () => {
    // Scenario: git added gone.txt on January 2 and deleted it on January 3; the newest log event is on January 2.
    const { repo, file } = makeRepoWithDeletedFile();
    // the history is complete in git.
    assert.equal(isHistoryCompleteInGit(repo, file, new Date("2026-01-02T00:00:00Z")), true);
});

test("test_isHistoryCompleteInGit_is_true_for_a_deleted_file_without_any_log_event", () => {
    // Scenario: the logs never changed gone.txt.
    const { repo, file } = makeRepoWithDeletedFile();
    assert.equal(isHistoryCompleteInGit(repo, file, undefined), true);
});

test("test_isHistoryCompleteInGit_is_false_when_a_log_event_changes_the_file_after_the_delete_commit", () => {
    // Scenario: a log event changes gone.txt on January 4, one day after git deleted it.
    const { repo, file } = makeRepoWithDeletedFile();
    assert.equal(isHistoryCompleteInGit(repo, file, new Date("2026-01-04T00:00:00Z")), false);
});

test("test_isHistoryCompleteInGit_is_false_when_the_file_is_on_disk_now", () => {
    // Scenario: git deleted gone.txt but a copy is on disk again.
    const { repo, file } = makeRepoWithDeletedFile();
    writeFileSync(file.toString(), "back");
    assert.equal(isHistoryCompleteInGit(repo, file, undefined), false);
});

test("test_isHistoryCompleteInGit_is_false_for_a_file_outside_the_repo", () => {
    // Scenario: a session scratchpad file that is gone and lies outside the repo folder.
    const { repo } = makeRepoWithDeletedFile();
    const fileOutsideRepo = new Path(join(makeScratchFolder(), "scratch.ts"));
    // git holds no history for it.
    assert.equal(isHistoryCompleteInGit(repo, fileOutsideRepo, undefined), false);
});

test("test_isHistoryCompleteInGit_is_false_when_the_last_git_hop_is_not_a_delete", () => {
    // Scenario: gone.txt was added by git but never deleted by git; it is absent on disk only.
    const { repo, file } = makeRepoWithDeletedFile();
    runGit(repo.toString(), ["revert", "--no-edit", "HEAD"], "2026-01-05T00:00:00Z");
    runGit(repo.toString(), ["rm", "-q", "gone.txt"], "2026-01-05T00:00:00Z");
    // only the working tree and index lose the file; the last commit that touched it re-added it.
    assert.equal(isHistoryCompleteInGit(repo, file, undefined), false);
});

test("test_check_solved_throws_on_the_first_file_that_no_longer_reconstructs", () => {
    // Scenario: a.txt and b.txt are solved in the cache; now the solver fails for b.txt.
    const folder = makeScratchFolder();
    const firstFile = makeFileOnDisk(folder, "a.txt", "a");
    const secondFile = makeFileOnDisk(folder, "b.txt", "b");
    const args = makeSolveAllArguments(folder, [], true);
    writeReconstructionCache(args.cacheFile, makeCache([makeFullyReconstructibleFile(firstFile), makeFullyReconstructibleFile(secondFile)], []));
    // the error names b.txt.
    assert.throws(() => tryToReconstructAllFiles(args, makeStubSolver(["a.txt"], []), () => {}), new Error(`codebase changes caused a regression and now ${secondFile.file.toString()} doesn't fully reconstruct!!`));
});

test("test_check_solved_passes_and_leaves_the_cache_file_alone_when_every_file_still_solves", () => {
    // Scenario: a.txt is solved in the cache and the solver still solves it.
    const folder = makeScratchFolder();
    const onDiskFile = makeFileOnDisk(folder, "a.txt", "a");
    const args = makeSolveAllArguments(folder, [], true);
    writeReconstructionCache(args.cacheFile, makeCache([makeFullyReconstructibleFile(onDiskFile)], []));
    const textBefore = readFileSync(args.cacheFile.toString(), "utf8");
    const askedFileNames: string[] = [];
    tryToReconstructAllFiles(args, makeStubSolver(["a.txt"], askedFileNames), () => {});
    // the solver was asked once and the cache file text is the same.
    assert.deepEqual(askedFileNames, [onDiskFile.file.toString()]);
    assert.equal(readFileSync(args.cacheFile.toString(), "utf8"), textBefore);
});
