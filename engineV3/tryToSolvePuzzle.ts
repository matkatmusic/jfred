// Solves the progress bar puzzle of ONE file: replay the file's events forward from its beacons and compare the end state with the file on disk now.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Path, Uuid } from "../src/structures/domain.ts";
import { PuzzleFailureReason } from "../src/structures/vocabulary.ts";
import { readEarliestBoundary, readFileTextAtBoundary } from "./engineV3_earliest_boundary.ts";
import { getFileCreationCommit } from "./engineV3_file_creation_commit.ts";
import { listGitHopsForFile } from "./engineV3_file_git_hops.ts";
import { createSingleFileEventsLoader } from "./engineV3_inverse_repos_for_project.ts";
import { listMoveOriginsNewestFirst } from "./engineV3_move_origins.ts";
import { isProgressBarPuzzleSolved, type Hop, type JSONLHop, type OnDiskFile, type ProgressBarPuzzle } from "./engineV3_puzzle_types.ts";
import { applyEditToText, countOccurrences, type EditRow } from "./engineV3_replay_reverse.ts";
import { FileEventType, createEvent, getEventBytes, isBeaconEvent, sortEventsNewestToOldest, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { buildOnDiskFile, readReconstructionCache, recordPuzzleResult, writeReconstructionCache } from "./solveAllProgressBarPuzzles.ts";
import { readTuiSettings } from "./tui/engineV3_tui_settings.ts";

type StepFailure = { reason: PuzzleFailureReason; detail: string | undefined };
export type PendingFailure = StepFailure & { hop: JSONLHop | undefined };

// The state after the replay: bytes is the text, isAbsent is a known absent file, and neither means unknown (a gap, with the first failure in pendingFailure).
export type ForwardReplay = { hops: Hop[]; bytes: string | undefined; isAbsent: boolean; pendingFailure: PendingFailure | undefined; lastAttemptedHop: JSONLHop | undefined };
export type ResolveMoveOrigin = (oldPath: Path, movedAt: Date) => ForwardReplay;

function throwOnMoveOrigin(oldPath: Path, movedAt: Date): ForwardReplay {
    throw new Error(`replayEventsForward: a move from ${oldPath.toString()} at ${movedAt.toISOString()} needs a move origin resolver`);
}

function getHopOfEvent(event: FileEvent, gitRepo: Path): Hop {
    const hop: Hop = {};
    if (event.source !== undefined) {
        hop.jsonlHop = { jsonlFile: new Path(event.source.filePath), lineNumber: event.source.lineNumber };
    }
    if (event.commitHash !== undefined) {
        hop.gitHop = { repo: gitRepo, commit: event.commitHash.toString() };
    }
    return hop;
}

// An Edit applies forward only when its old text is in the bytes exactly once (replaceAll off) or at least once (replaceAll on).
function findEditFailure(bytes: string, editRow: EditRow): StepFailure | undefined {
    const occurrenceCount = countOccurrences(bytes, editRow.oldString);
    if (occurrenceCount === 0) {
        return { reason: PuzzleFailureReason.EditOldTextNotFound, detail: undefined };
    }
    if (!editRow.replaceAll) {
        if (occurrenceCount > 1) {
            return { reason: PuzzleFailureReason.EditOldTextFoundManyTimes, detail: `${occurrenceCount} times` };
        }
    }
    return undefined;
}

function createFailedReplay(reason: PuzzleFailureReason, detail: string | undefined): ForwardReplay {
    return { hops: [], bytes: undefined, isAbsent: false, pendingFailure: { reason, detail, hop: undefined }, lastAttemptedHop: undefined };
}

// The events are oldest first. A beacon sets the bytes; an exact Edit applies; a read changes nothing; a move takes the bytes of the old path.
// A step that would need a guess leaves the bytes unknown until the next beacon: a gap in the middle is allowed.
export function replayEventsForward(eventsOldestFirst: FileEvent[], gitRepo: Path, resolveMoveOrigin: ResolveMoveOrigin): ForwardReplay {
    const forwardEvents = eventsOldestFirst.filter((event) => event.type !== FileEventType.DiskNow);
    if (forwardEvents.length === 0) {
        return createFailedReplay(PuzzleFailureReason.NoEvents, undefined);
    }
    const hops: Hop[] = [];
    let bytes: string | undefined;
    let isAbsent = false;
    let pendingFailure: PendingFailure | undefined;
    let lastAttemptedHop: JSONLHop | undefined;
    for (const event of forwardEvents) {
        const eventHop = getHopOfEvent(event, gitRepo);
        if (eventHop.jsonlHop !== undefined) {
            lastAttemptedHop = eventHop.jsonlHop;
        }
        if (isBeaconEvent(event)) {
            if (event.type === FileEventType.GitCommit && event.bytes === undefined) {
                bytes = undefined;
                isAbsent = true;
            } else {
                bytes = getEventBytes(event);
                if (bytes === undefined) {
                    throw new Error(`replayEventsForward: the beacon ${event.type} has no bytes`);
                }
                isAbsent = false;
            }
            hops.push(eventHop);
            pendingFailure = undefined;
            continue;
        }
        let failure: StepFailure | undefined;
        switch (event.type) {
            case FileEventType.ReadPartial:
            case FileEventType.ScriptReadOnly:
                break;
            case FileEventType.EditRow:
                if (bytes === undefined) {
                    failure = { reason: PuzzleFailureReason.EditOldTextNotFound, detail: isAbsent ? "the file is absent before this Edit" : "no bytes before this Edit" };
                } else {
                    failure = findEditFailure(bytes, event.row as EditRow);
                    if (failure === undefined) {
                        bytes = applyEditToText(bytes, event.row as EditRow);
                        hops.push(eventHop);
                    }
                }
                break;
            case FileEventType.ScriptMayWrite:
            case FileEventType.OtherRow:
                if (event.moveOrCopySourceFile !== undefined) {
                    const moveOrigin = listMoveOriginsNewestFirst([event])[0]!;
                    const originReplay = resolveMoveOrigin(moveOrigin.oldPath, moveOrigin.movedAt);
                    if (originReplay.bytes === undefined) {
                        failure = originReplay.pendingFailure?.reason === undefined ? { reason: PuzzleFailureReason.ScriptMayWrite, detail: "the old path is absent" } : originReplay.pendingFailure;
                    } else {
                        bytes = originReplay.bytes;
                        isAbsent = false;
                        hops.push(...originReplay.hops, eventHop);
                        pendingFailure = undefined;
                    }
                    break;
                }
                if (event.removedByScript || event.movedAwayToFile !== undefined) {
                    bytes = undefined;
                    isAbsent = true;
                    hops.push(eventHop);
                    pendingFailure = undefined;
                    break;
                }
                failure = { reason: PuzzleFailureReason.ScriptMayWrite, detail: undefined };
                break;
            case FileEventType.UserEditNotice:
                failure = { reason: PuzzleFailureReason.UserEditNotice, detail: undefined };
                break;
            default:
                throw new Error(`replayEventsForward: no rule for the event type ${event.type}`);
        }
        if (failure !== undefined) {
            bytes = undefined;
            isAbsent = false;
            if (pendingFailure === undefined) {
                pendingFailure = { reason: failure.reason, detail: failure.detail, hop: eventHop.jsonlHop };
            }
        }
    }
    if (bytes === undefined) {
        if (!isAbsent) {
            if (pendingFailure === undefined) {
                pendingFailure = { reason: PuzzleFailureReason.NoEvents, detail: "no event sets the bytes", hop: lastAttemptedHop };
            }
        }
    }
    return { hops, bytes, isAbsent, pendingFailure, lastAttemptedHop };
}

export function buildProgressBarPuzzleForFile(file: OnDiskFile, eventsOldestFirst: FileEvent[], gitRepo: Path, resolveMoveOrigin: ResolveMoveOrigin = throwOnMoveOrigin): ProgressBarPuzzle {
    return buildPuzzleFromReplay(file, replayEventsForward(eventsOldestFirst, gitRepo, resolveMoveOrigin));
}

function buildPuzzleFromReplay(file: OnDiskFile, replay: ForwardReplay): ProgressBarPuzzle {
    if (replay.bytes === undefined) {
        if (!replay.isAbsent) {
            return { file, hops: replay.hops, bytes: "", lastAttemptedHop: replay.pendingFailure!.hop, failureReason: replay.pendingFailure!.reason, failureDetail: replay.pendingFailure!.detail };
        }
    }
    const puzzle: ProgressBarPuzzle = { file, hops: replay.hops, bytes: replay.bytes ?? "", isFileAbsentAtEnd: replay.isAbsent, lastAttemptedHop: replay.lastAttemptedHop, failureReason: undefined, failureDetail: undefined };
    if (!isProgressBarPuzzleSolved(puzzle)) {
        puzzle.failureReason = PuzzleFailureReason.FinalHashMismatch;
    }
    return puzzle;
}

type SolveContext = { allJSONLs: Path[]; gitRepo: Path; commitHash: string; snapshotFolders: Path[] };

// One GitCommit beacon per commit that touches the file; a delete commit has no bytes.
// function createGitHopEvents(path: Path, context: SolveContext): FileEvent[] {
function createGitHopEvents(path: Path, context: Pick<SolveContext, "gitRepo">): FileEvent[] {
    return listGitHopsForFile(context.gitRepo, path).map((gitHop) => {
        const commitBoundary = readEarliestBoundary(context.gitRepo, new Uuid(gitHop.commit));
        let bytes: string | undefined;
        if (!gitHop.isDelete) {
            bytes = readFileTextAtBoundary(commitBoundary, gitHop.pathAtCommit).text;
            if (bytes === undefined) {
                throw new Error(`createGitHopEvents: ${gitHop.pathAtCommit.toString()} has no text in commit ${gitHop.commit}`);
            }
        }
        return createEvent(FileEventType.GitCommit, commitBoundary.instant, undefined, { commitHash: commitBoundary.commit, bytes });
    });
}

// Layer 1 of the puzzle (B_BUILD_GIT_BEACON_LAYER): the git beacons of one file, newest first.
export function getGitBeacons(repo: Path, file: Path): FileEvent[] {
    return createGitHopEvents(file, { gitRepo: repo }).reverse();
}

// The replay of one path up to (not including) the instant `until`; no instant means up to now.
// The start beacon is per file: its creation commit at or before the start commit. A file with no creation commit and no move onto it is born after the start.
function replayPathBefore(path: Path, until: Date | undefined, context: SolveContext): ForwardReplay {
    const loadEventsNewestFirst = createSingleFileEventsLoader([{ file: path, transcriptFile: path }], context.allJSONLs, context.snapshotFolders);
    let events = loadEventsNewestFirst(0);
    const hasMoveOrigin = listMoveOriginsNewestFirst(events).length > 0;
    const startBoundary = readEarliestBoundary(context.gitRepo, new Uuid(context.commitHash));
    if (readFileTextAtBoundary(startBoundary, path).isInsideRepo) {
        const creation = getFileCreationCommit(context.gitRepo, context.commitHash, path);
        if (creation === undefined) {
            if (!hasMoveOrigin) {
                return createFailedReplay(PuzzleFailureReason.BornAfterStart, undefined);
            }
        }
        const gitEvents = createGitHopEvents(path, context);
        let logEvents = events.filter((event) => event.type !== FileEventType.GitCommit);
        if (creation !== undefined) {
            const creationInstant = gitEvents[0]!.instant!;
            logEvents = logEvents.filter((event) => event.instant === undefined || event.instant.getTime() > creationInstant.getTime());
        }
        // The git events go in newest first, so the stable sort keeps the commit order for commits of the same second.
        events = sortEventsNewestToOldest([...logEvents, ...[...gitEvents].reverse()]);
    }
    if (until !== undefined) {
        events = events.filter((event) => event.instant !== undefined && event.instant.getTime() < until.getTime());
    }
    return replayEventsForward([...events].reverse(), context.gitRepo, (oldPath, movedAt) => replayPathBefore(oldPath, movedAt, context));
}

const CACHE_FILE_NAME = "reconstruction-cache.json";
const USAGE = "usage: node --import tsx engineV3/tryToSolvePuzzle.ts --settings <file.json> --file <absolute file path>   (the settings need repo and commit)";

// One file: solve it, put it in the fully reconstructible list or the requires further research list, and write the cache.
function main(): void {
    const argv = process.argv.slice(2);
    const fileFlagIndex = argv.indexOf("--file");
    if (fileFlagIndex === -1) {
        throw new Error(USAGE);
    }
    const fileText = argv[fileFlagIndex + 1];
    if (fileText === undefined) {
        throw new Error(USAGE);
    }
    const settings = readTuiSettings(argv.filter((_argument, index) => index !== fileFlagIndex && index !== fileFlagIndex + 1));
    if (settings.repoFolder === undefined) {
        throw new Error(USAGE);
    }
    const cacheFile = new Path(join(settings.storeFolder.toString(), CACHE_FILE_NAME));
    const puzzle = tryToSolveProgressBarPuzzle(buildOnDiskFile(new Path(fileText)), settings.jsonlsFolders, settings.repoFolder, settings.commit!.toString(), settings.fileHistoryFolders);
    writeReconstructionCache(cacheFile, recordPuzzleResult(readReconstructionCache(cacheFile), puzzle));
    console.log(`${fileText} solved=${isProgressBarPuzzleSolved(puzzle)} reason=${puzzle.failureReason ?? "none"} detail=${puzzle.failureDetail ?? "none"} hops=${puzzle.hops.length} lastAttemptedHop=${JSON.stringify(puzzle.lastAttemptedHop)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
    main();
}

// allJSONLs are the folders of the logs; snapshotFolders are the file-history folders; gitRepo and commitHash name the start commit.
export function tryToSolveProgressBarPuzzle(file: OnDiskFile, allJSONLs: Path[], gitRepo: Path, commitHash: string, snapshotFolders: Path[]): ProgressBarPuzzle {
    const context: SolveContext = { allJSONLs, gitRepo, commitHash, snapshotFolders };
    return buildPuzzleFromReplay(file, replayPathBefore(file.file, undefined, context));
}
