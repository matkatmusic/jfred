# Puzzle solver rules: table

The diagram is the file `plans/puzzle-solver-rules.mmd`. This file holds the rule table and the notes. Checked against the code on 2026-11-19. Code is the truth: when the diagram or the table differs from the code, fix the diagram or the table.

## How to add a rule

New rule = new id (next free R number), new box in `puzzle-solver-rules.mmd`, new table row below, all in the same commit as the code.

Node names follow the mermaid-editor standard (`~/Programming/relationship-mermaid/mermaid-editor/README.md`, "Node names"): `B_` = one step `[]`, `Q_` = a question `{}`, `Q_CHOICE_<question without Q_>_<answer>` = one answer `[]`. No other name start, no round shapes. Check the diagram with `bun ~/Programming/relationship-mermaid/mermaid-editor/check-diagram.ts plans/puzzle-solver-rules.mmd`.

## Notes

- A failure makes the bytes unknown. The first failure after the last closed gap is the one reported. Later failures while the bytes are unknown are ignored and their Edits are not tried.
- A gap in the middle is allowed: the next beacon, a move that resolves, or a removal makes the state known again and clears the reported failure.
- After a run, files already in `fullyReconstructibleFiles` are skipped. `--check-solved` solves each of them again and throws `codebase changes caused a regression and now <file> doesn't fully reconstruct!!` on the first one that no longer solves.

## Rule table

| rule id | rule | code file:function | date added | why (user ruling) |
|---|---|---|---|---|
| R1 | A file absent on disk now is still a puzzle (hashNow = ABSENT_FILE_HASH), unless R2 excludes it | engineV3/solveAllProgressBarPuzzles.ts:buildOnDiskFile, tryToReconstructAllFiles | 2026-11-19 | Helper 30: absent files are puzzles too |
| R2 | Absent on disk now, inside the repo, last git hop is a delete, no log event changes it after that commit: excluded, listed in filesWithHistoryCompleteInGit | engineV3/solveAllProgressBarPuzzles.ts:isHistoryCompleteInGit; caller engineV3/solveAllProgressBarPuzzlesMain.ts:main | 2026-11-19 | Helper 30: git already holds the whole history (the jot TO_DELETE files) |
| R3 | The per-file start rule runs only when F is inside the repo at the start commit; a file outside the repo or in a submodule keeps its loaded events | engineV3/tryToSolvePuzzle.ts:replayPathBefore (readFileTextAtBoundary.isInsideRepo) | 2026-11-19 | Kept from the first version: files outside the repo have no start commit |
| R4 | The start of a file is its creation commit at or before the start commit, following renames; no creation commit means born after the start | engineV3/engineV3_file_creation_commit.ts:getFileCreationCommit; engineV3/tryToSolvePuzzle.ts:replayPathBefore | 2026-11-19 | User ruling: the start beacon is per file |
| R5 | A file with no creation commit but with a move or copy onto it is not BornAfterStart: its history comes from the old path | engineV3/tryToSolvePuzzle.ts:replayPathBefore (listMoveOriginsNewestFirst) | 2026-11-19 | User ruling 3 (born later = research) and rule 4 (moved by a script: follow the old path) |
| R6 | No event left after removing the disk-now event: NoEvents | engineV3/tryToSolvePuzzle.ts:replayEventsForward | 2026-11-19 | Nothing to replay; the disk is the target, not an input |
| R7 | Beacons set the bytes: git commit, file-history snapshot, Write, whole Read, Edit with originalFile; every git commit from creation to HEAD is a beacon; a git delete commit sets absent | engineV3/tryToSolvePuzzle.ts:replayEventsForward, createGitHopEvents; engineV3/engineV3_file_git_hops.ts:listGitHopsForFile; engineV3/engineV3_replay_reverse_events.ts:isBeaconEvent | 2026-11-19 | User ruling 1: git commits, snapshots and whole Reads are beacons |
| R8 | An Edit without originalFile when the text is unknown or absent: failure EditOldTextNotFound | engineV3/tryToSolvePuzzle.ts:replayEventsForward | 2026-11-19 | An Edit cannot be applied without text |
| R9 | An Edit applies forward only when the old text occurs exactly once (replaceAll off) or at least once (replaceAll on); 0 times = EditOldTextNotFound, many times = EditOldTextFoundManyTimes | engineV3/tryToSolvePuzzle.ts:findEditFailure | 2026-11-19 | User ruling 2 |
| R10 | A script event that moves or copies an old path onto F takes the old path bytes; a script event that removes F or moves it away sets absent; any other script event is failure ScriptMayWrite (a script is never run) | engineV3/tryToSolvePuzzle.ts:replayEventsForward | 2026-11-19 | User ruling 4 (follow the old path); the absent step is a choice of helper 32, open for the user to confirm; jot stays read only |
| R11 | The old path is replayed up to the move instant (strictly before it) by the same rules; its failure becomes the failure of F; an absent old path is failure ScriptMayWrite | engineV3/tryToSolvePuzzle.ts:replayPathBefore, replayEventsForward | 2026-11-19 | User ruling 4: before the move, the puzzle uses the old path history |
| R12 | The end state must be known (text or absent); otherwise the first reported failure is the research reason, with its log line as lastAttemptedHop | engineV3/tryToSolvePuzzle.ts:replayEventsForward, buildPuzzleFromReplay | 2026-11-19 | Shared spec: record lastAttemptedHop and failureReason |
| R13 | Solved means hash(end bytes) equals hashNow; an absent end equals ABSENT_FILE_HASH; a gap in the middle is allowed; otherwise FinalHashMismatch | engineV3/engineV3_puzzle_types.ts:isProgressBarPuzzleSolved; engineV3/tryToSolvePuzzle.ts:buildPuzzleFromReplay | 2026-11-19 | User ruling 1 |
| R14 | A UserEditNotice event is a failure UserEditNotice | engineV3/tryToSolvePuzzle.ts:replayEventsForward | 2026-11-19 | A hand edit by the user changes bytes in a way no log line shows |
| R15 | An event kind with no rule (for example RowBytesUnknown) throws; it is not hidden | engineV3/tryToSolvePuzzle.ts:replayEventsForward | 2026-11-19 | User rule: do not hide failures, let it throw |
| R16 | Events replay one at a time, oldest first; when none is left the end state is judged by R12 and R13 | engineV3/tryToSolvePuzzle.ts:replayEventsForward | 2026-11-19 | Shared spec: forward replay oldest to newest |
