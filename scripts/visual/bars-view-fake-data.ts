// Fake inverse repos for the Bars view check. Commit times come from the real ruler rows (newest first), never made up.

import type { InverseCommitWire, InverseProgressLine, InverseRepoFileWire, InverseReposWire } from "../../webapp/layer1-components/bars-view/layer1-bars-wire.ts";

export const FAKE_CREATED_PATH = "src/created.ts";
export const FAKE_DELETED_PATH = "src/deleted.ts";
export const FAKE_MOVED_PATH = "src/moved.ts";
export const FAKE_PLAIN_PATH = "src/plain.ts";
export const FAKE_MOVED_DESTINATION = "/fixture/demo/worktree/src/moved-new.ts";
export const FAKE_OTHER_STATUS_TEXT = "Rebuilding the file states";
export const FAKE_FIRST_LOG_FILE = "11111111-aaaa-4bbb-8ccc-000000000001.jsonl";
export const FAKE_SECOND_LOG_FILE = "22222222-aaaa-4bbb-8ccc-000000000002.jsonl";
export const FAKE_ERROR_TEXT ="the fake inverse repos failed";
export const MINIMUM_RULER_ROW_COUNT = 8;

type CommitSpec = { eventType: string; row: number | null; isFileAbsent: boolean; isRemoved: boolean; movedAwayTo: string | null };

function specifyPresent(eventType: string, row: number): CommitSpec {
    return { eventType, row, isFileAbsent: false, isRemoved: false, movedAwayTo: null };
}

function specifyAbsent(eventType: string, row: number, isRemoved: boolean, movedAwayTo: string | null): CommitSpec {
    return { eventType, row, isFileAbsent: true, isRemoved, movedAwayTo };
}

function specifyDiskNow(isFileAbsent: boolean): CommitSpec {
    return { eventType: "DiskNow", row: null, isFileAbsent, isRemoved: false, movedAwayTo: null };
}

function readRowTime(rowTimes: readonly string[], row: number): string {
    const rowTime = rowTimes[row];
    if (rowTime === undefined) {
        throw new Error(`the ruler has no row ${row}`);
    }
    return rowTime;
}

function readReaderInstant(rowTimes: readonly string[], spec: CommitSpec, instant: string | null): string | null {
    if (instant !== null) {
        return instant;
    }
    if (spec.isFileAbsent) {
        return null;
    }
    return readRowTime(rowTimes, 0);
}

function buildCommit(path: string, rowTimes: readonly string[], spec: CommitSpec, position: number): InverseCommitWire {
    const instant = spec.row === null ? null : readRowTime(rowTimes, spec.row);
    return {
        commitHash: `${path}@${position}`,
        treeHash: `tree:${path}@${position}`,
        eventType: spec.eventType,
        moment: "at-event",
        confidence: "proven",
        position,
        instant,
        readerInstant: readReaderInstant(rowTimes, spec, instant),
        isFileAbsent: spec.isFileAbsent,
        isRemoved: spec.isRemoved,
        movedAwayTo: spec.movedAwayTo,
    };
}

function buildFile(path: string, rowTimes: readonly string[], specs: CommitSpec[]): InverseRepoFileWire {
    return { file: path, commits: specs.map((spec, position) => buildCommit(path, rowTimes, spec, position)) };
}

function buildCreatedFile(rowTimes: readonly string[]): InverseRepoFileWire {
    return buildFile(FAKE_CREATED_PATH, rowTimes, [
        specifyDiskNow(false), specifyPresent("GitCommit", 1), specifyPresent("EditRow", 2), specifyAbsent("BackupSnapshot", 3, false, null),
    ]);
}

function buildDeletedFile(rowTimes: readonly string[]): InverseRepoFileWire {
    return buildFile(FAKE_DELETED_PATH, rowTimes, [
        specifyDiskNow(true), specifyAbsent("GitCommit", 2, true, null), specifyPresent("GitCommit", 3), specifyAbsent("GitCommit", 4, false, null),
    ]);
}

function buildMovedFile(rowTimes: readonly string[]): InverseRepoFileWire {
    const lastRow = rowTimes.length - 1;
    return buildFile(FAKE_MOVED_PATH, rowTimes, [
        specifyDiskNow(true), specifyAbsent("GitCommit", 2, false, FAKE_MOVED_DESTINATION), specifyPresent("WriteRow", 3), specifyPresent("GitCommit", lastRow),
    ]);
}

function buildPlainFile(rowTimes: readonly string[]): InverseRepoFileWire {
    const lastRow = rowTimes.length - 1;
    return buildFile(FAKE_PLAIN_PATH, rowTimes, [
        specifyDiskNow(false), specifyPresent("GitCommit", 1), specifyPresent("ReadWhole", 2), specifyPresent("WriteRow", 3),
        specifyPresent("BackupSnapshot", 4), specifyPresent("GitCommit", lastRow),
    ]);
}

function buildScriptFile(rowTimes: readonly string[]): InverseRepoFileWire {
    const lastRow = rowTimes.length - 1;
    return buildFile("scripts/run.sh", rowTimes, [
        specifyDiskNow(false), specifyPresent("ScriptMayWrite", 1), specifyPresent("EditRow", 3), specifyPresent("GitCommit", lastRow),
    ]);
}

function buildNotesFile(rowTimes: readonly string[]): InverseRepoFileWire {
    const lastRow = rowTimes.length - 1;
    return buildFile("docs/notes.md", rowTimes, [
        specifyDiskNow(false), specifyPresent("UserEditNotice", 2), specifyPresent("BackupSnapshot", 5), specifyPresent("GitCommit", lastRow),
    ]);
}

export function buildFakeFiles(rowTimes: readonly string[]): InverseRepoFileWire[] {
    if (rowTimes.length < MINIMUM_RULER_ROW_COUNT) {
        throw new Error(`the fake files need ${MINIMUM_RULER_ROW_COUNT} ruler rows, the page has ${rowTimes.length}`);
    }
    return [buildCreatedFile(rowTimes), buildDeletedFile(rowTimes), buildMovedFile(rowTimes), buildPlainFile(rowTimes), buildScriptFile(rowTimes), buildNotesFile(rowTimes)];
}

// A file that is gone now has its DiskNow commit left out of the dots.
export function countExpectedDots(files: readonly InverseRepoFileWire[]): number {
    let dotCount = 0;
    for (const file of files) {
        dotCount += file.commits.length;
        if (file.commits[0]?.isFileAbsent === true) {
            dotCount -= 1;
        }
    }
    return dotCount;
}

export function buildFakeStreamLines(files: readonly InverseRepoFileWire[]): string[] {
    const progressLines: InverseProgressLine[] = [
        { kind: "progress", label: FAKE_FIRST_LOG_FILE, logFile: FAKE_FIRST_LOG_FILE },
        { kind: "progress", label: FAKE_SECOND_LOG_FILE, logFile: FAKE_SECOND_LOG_FILE },
        { kind: "progress", label: "Reading session logs", current: 0, total: files.length },
        { kind: "progress", label: FAKE_OTHER_STATUS_TEXT },
    ];
    for (const [fileIndex, file] of files.entries()) {
        progressLines.push({ kind: "progress", label: "Replaying a file", file: file.file, fileStepsDone: 1, fileStepsTotal: 2 });
        progressLines.push({ kind: "progress", label: "Replayed a file", file: file.file, current: fileIndex + 1, total: files.length });
    }
    const resultLine: InverseReposWire = { files: [...files] };
    return [...progressLines.map((line) => JSON.stringify(line)), JSON.stringify(resultLine)];
}

export function buildFakeErrorLines(): string[] {
    const startedLine: InverseProgressLine = { kind: "progress", label: "Reading session logs", current: 0, total: 1 };
    return [JSON.stringify(startedLine), JSON.stringify({ kind: "error", label: FAKE_ERROR_TEXT })];
}
