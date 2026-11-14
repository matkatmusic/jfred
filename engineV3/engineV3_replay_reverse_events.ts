// Reverse mode: every event that names or touches one file, newest to oldest, becomes a node of the file bubble.

import { getRecordSource, type RecordSource } from "../src/parse/loadTranscript.ts";
import { collectReadEchoNodes } from "../src/layered_anchor.ts";
import { isScriptCodeWriteCapable } from "../src/reconstruction_script_prestate.ts";
import { Path } from "../src/structures/domain.ts";
import { normalizeAgainstCwd } from "../src/structures/path-resolve.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary_views.ts";
import { RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { CommitHash, JSONLLine } from "./engineV3.ts";
import {
  ReverseStateKind, applyEditToText, collectBackupKnownStates, collectGitKnownStates, collectScriptRuns, computeRowUndo, countOccurrences, createFileNamePattern,
  createReverseState, getUndoneStateKind, listFileChangeRowsNewestFirst, loadJSONLLinesNamingFile, parseFileChangeRow, readDiskText,
  type EditRow, type FileChangeRow, type KnownFileState, type ReverseFileState,
} from "./engineV3_replay_reverse.ts";

export enum FileEventType {
  DiskNow = "DiskNow",
  GitCommit = "GitCommit",
  BackupSnapshot = "BackupSnapshot",
  WriteRow = "WriteRow",
  EditRow = "EditRow",
  ReadWhole = "ReadWhole",
  ReadPartial = "ReadPartial",
  ScriptReadOnly = "ScriptReadOnly",
  ScriptMayWrite = "ScriptMayWrite",
  OtherRow = "OtherRow",
  RowBytesUnknown = "RowBytesUnknown",
}

export type FileEvent = { type: FileEventType; instant: Date | undefined; source: RecordSource | undefined; commitHash: CommitHash | undefined; bytes: string | undefined; row: FileChangeRow | undefined };
export type ReverseEventsResult = { states: ReverseFileState[]; unhandledEvents: FileEvent[] };

enum EntryRole { Own, RowAfter, RowBefore }
type Entry = { event: FileEvent; role: EntryRole; bytes: string | undefined };

function createEvent(type: FileEventType, instant: Date | undefined, source: RecordSource | undefined, fields: Partial<FileEvent> = {}): FileEvent {
  return { type, instant, source, commitHash: undefined, bytes: undefined, row: undefined, ...fields };
}

function convertKnownStateToEvent(type: FileEventType, state: KnownFileState): FileEvent {
  return createEvent(type, state.timestamp, state.source, { commitHash: state.commitHash, bytes: state.content });
}

function groupLinesBySourceFile(jsonlLines: JSONLLine[]): Map<string, JSONLLine[]> {
  const linesBySourceFile = new Map<string, JSONLLine[]>();
  for (const line of jsonlLines) {
    const sourceFile = getRecordSource(line)!.filePath;
    linesBySourceFile.set(sourceFile, [...(linesBySourceFile.get(sourceFile) ?? []), line]);
  }
  return linesBySourceFile;
}

function listReadEvents(transcriptFile: Path, jsonlLines: JSONLLine[]): FileEvent[] {
  const events: FileEvent[] = [];
  for (const [sourceFile, lines] of groupLinesBySourceFile(jsonlLines)) {
    for (const placement of collectReadEchoNodes(lines, new Path(sourceFile))) {
      if (placement.target.equals(transcriptFile)) {
        const node = placement.node;
        if (node.kind === LayeredNodeKind.beacon) {
          events.push(createEvent(FileEventType.ReadWhole, placement.instant, { filePath: sourceFile, lineNumber: node.evidence!.line }, { bytes: node.content }));
        }
        if (node.kind === LayeredNodeKind.preAnchorStub) {
          events.push(createEvent(FileEventType.ReadPartial, placement.instant, { filePath: sourceFile, lineNumber: node.evidence!.line }));
        }
      }
    }
  }
  return events;
}

const PATH_START_BOUNDARY = /[\s"'`=(<>|;&,]/;

function listPathTextsEndingAtName(code: string, nameStart: number, nameEnd: number): string[] {
  const lineStart = code.lastIndexOf("\n", nameStart - 1) + 1;
  const pathTexts: string[] = [];
  for (let start = nameStart; start >= lineStart; start--) {
    let isPathStart = start === lineStart;
    if (!isPathStart) {
      isPathStart = PATH_START_BOUNDARY.test(code[start - 1]!);
    }
    if (isPathStart) {
      pathTexts.push(code.slice(start, nameEnd));
    }
  }
  return pathTexts;
}

// A relative path text is resolved against the run's cwd; shell variables, globs, ~ and a cd earlier in the command are not resolved, so such a text never matches.
function isFileNamedByPathInScript(scriptRun: ScriptRun, transcriptFile: Path): boolean {
  const namePattern = new RegExp(createFileNamePattern(transcriptFile).source, "g");
  for (const nameMatch of scriptRun.code.matchAll(namePattern)) {
    const nameStart = nameMatch.index!;
    for (const pathText of listPathTextsEndingAtName(scriptRun.code, nameStart, nameStart + nameMatch[0].length)) {
      if (new Path(normalizeAgainstCwd(scriptRun.cwd, new Path(pathText))).equals(transcriptFile)) {
        return true;
      }
    }
  }
  return false;
}

function listScriptEvents(transcriptFile: Path, jsonlLines: JSONLLine[]): FileEvent[] {
  const fileNamePattern = createFileNamePattern(transcriptFile);
  const events: FileEvent[] = [];
  for (const scriptRun of collectScriptRuns(jsonlLines)) {
    if (fileNamePattern.test(scriptRun.code)) {
      if (scriptRun.cwd === undefined) {
        throw new Error(`listScriptEvents: the script run at ${scriptRun.timestamp.toISOString()} names ${transcriptFile.toString()} and has no cwd`);
      }
      if (isFileNamedByPathInScript(scriptRun, transcriptFile)) {
        let type = FileEventType.ScriptReadOnly;
        if (isScriptCodeWriteCapable(scriptRun.code)) {
          type = FileEventType.ScriptMayWrite;
        }
        events.push(createEvent(type, scriptRun.timestamp, scriptRun.source));
      }
    }
  }
  return events;
}

// A tool result that carries the file's path but is neither an applied Write nor an applied Edit.
function listOtherRowEvents(transcriptFile: Path, jsonlLines: JSONLLine[]): FileEvent[] {
  const events: FileEvent[] = [];
  for (const line of jsonlLines) {
    if (line.type === RecordType.user) {
      const result = line.toolUseResult as Record<string, unknown> | string | null | undefined;
      if (typeof result === "object") {
        if (result !== null) {
          if (typeof result.filePath === "string") {
            if (new Path(result.filePath).equals(transcriptFile)) {
              if (parseFileChangeRow(line, transcriptFile) === undefined) {
                events.push(createEvent(FileEventType.OtherRow, line.timestamp as Date, getRecordSource(line)));
              }
            }
          }
        }
      }
    }
  }
  return events;
}

// The transcripts may call the file by another path than the one on disk (a scenario run folder); transcriptFile is that path.
export function getAllEventsForFileFrom(file: Path, transcriptFile: Path, jsonlFolders: Path[], snapshotFolders: Path[]): FileEvent[] {
  const jsonlLines = loadJSONLLinesNamingFile(transcriptFile, jsonlFolders);
  const events: FileEvent[] = [createEvent(FileEventType.DiskNow, undefined, undefined, { bytes: readDiskText(file) })];
  for (const state of collectGitKnownStates(file)) {
    events.push(convertKnownStateToEvent(FileEventType.GitCommit, state));
  }
  for (const state of collectBackupKnownStates(transcriptFile, jsonlLines, snapshotFolders)) {
    events.push(convertKnownStateToEvent(FileEventType.BackupSnapshot, state));
  }
  for (const row of listFileChangeRowsNewestFirst(jsonlLines, transcriptFile)) {
    const type = row.toolName === ToolName.Write ? FileEventType.WriteRow : FileEventType.EditRow;
    events.push(createEvent(type, row.timestamp, row.source, { row }));
  }
  events.push(...listReadEvents(transcriptFile, jsonlLines), ...listScriptEvents(transcriptFile, jsonlLines), ...listOtherRowEvents(transcriptFile, jsonlLines));
  return events;
}

function isEditWithoutOriginalFile(event: FileEvent): boolean {
  if (event.type !== FileEventType.EditRow) {
    return false;
  }
  return event.row!.originalFile === undefined;
}

// A beacon carries the file's whole text by itself.
export function isBeaconEvent(event: FileEvent): boolean {
  if (event.type === FileEventType.EditRow) {
    return !isEditWithoutOriginalFile(event);
  }
  return [FileEventType.DiskNow, FileEventType.GitCommit, FileEventType.BackupSnapshot, FileEventType.WriteRow, FileEventType.ReadWhole].includes(event.type);
}

export function pruneBeaconsFromEvents(events: FileEvent[]): FileEvent[] {
  return events.filter((event) => !isBeaconEvent(event));
}

export function isEventTypeHandled(event: FileEvent): boolean {
  return isBeaconEvent(event) || isEditWithoutOriginalFile(event);
}

export function getEventBytes(event: FileEvent): string | undefined {
  if (event.row === undefined) {
    return event.bytes;
  }
  const textAfter = computeRowUndo(event.row, undefined).textAfter;
  if (textAfter === undefined) {
    throw new Error(`getEventBytes: the ${event.type} at ${event.instant?.toISOString()} has no bytes of its own`);
  }
  return textAfter;
}

function getEventSortKey(event: FileEvent): number {
  if (event.instant === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }
  return event.instant.getTime();
}

export function sortEventsNewestToOldest(events: FileEvent[]): FileEvent[] {
  return [...events].sort((leftEvent, rightEvent) => getEventSortKey(rightEvent) - getEventSortKey(leftEvent));
}

export function formatUnhandledEventLines(unhandledEvents: FileEvent[]): string[] {
  const countByType = new Map<FileEventType, number>();
  const newestByType = new Map<FileEventType, Date>();
  for (const event of unhandledEvents) {
    countByType.set(event.type, (countByType.get(event.type) ?? 0) + 1);
    const newest = newestByType.get(event.type);
    if (newest === undefined || event.instant!.getTime() > newest.getTime()) {
      newestByType.set(event.type, event.instant!);
    }
  }
  return [...countByType].map(([type, count]) => `unhandled ${type}  count ${count}  newest ${newestByType.get(type)!.toISOString()}`);
}

export function printUnhandledEvents(unhandledEvents: FileEvent[]): void {
  for (const line of formatUnhandledEventLines(unhandledEvents)) {
    console.error(line);
  }
}

function getPassiveStateKind(event: FileEvent): ReverseStateKind {
  if (event.type === FileEventType.ReadPartial || event.type === FileEventType.ScriptReadOnly) {
    return ReverseStateKind.ReadOnly;
  }
  return ReverseStateKind.PossibleChange;
}

function getOwnStateKind(event: FileEvent): ReverseStateKind {
  switch (event.type) {
    case FileEventType.DiskNow:
      return ReverseStateKind.DiskNow;
    case FileEventType.GitCommit:
      return ReverseStateKind.GitCommit;
    case FileEventType.BackupSnapshot:
      return ReverseStateKind.BackupSnapshot;
    case FileEventType.ReadWhole:
      return ReverseStateKind.ReadOnly;
    default:
      return getUndoneStateKind(event.row!);
  }
}

// The text of the next older event that has one; an Edit without originalFile is applied to it.
function findNextOlderEventBytes(events: FileEvent[], index: number): { isFound: boolean; bytes: string | undefined } {
  for (const olderEvent of events.slice(index + 1)) {
    if (isBeaconEvent(olderEvent)) {
      return { isFound: true, bytes: getEventBytes(olderEvent) };
    }
  }
  return { isFound: false, bytes: undefined };
}

function expandEventIntoEntries(events: FileEvent[], index: number, currentBytes: string | undefined): { entries: Entry[]; isBytesMissing: boolean } {
  const event = events[index]!;
  if (event.row === undefined) {
    return { entries: [{ event, role: EntryRole.Own, bytes: getEventBytes(event) }], isBytesMissing: false };
  }
  const undo = computeRowUndo(event.row, currentBytes);
  let textAfter = undo.textAfter;
  let textBefore = undo.textBefore;
  if (textAfter === undefined) {
    if (undo.matchesCurrentText) {
      textAfter = currentBytes;
    } else {
      const older = findNextOlderEventBytes(events, index);
      const editRow = event.row as EditRow;
      if (older.bytes !== undefined) {
        if (!editRow.replaceAll) {
          if (countOccurrences(older.bytes, editRow.oldString) === 1) {
            textBefore = { isKnown: true, text: older.bytes };
            textAfter = applyEditToText(older.bytes, editRow);
          }
        }
      }
    }
  }
  if (textAfter === undefined) {
    return { entries: [], isBytesMissing: true };
  }
  const entries: Entry[] = [{ event, role: EntryRole.RowAfter, bytes: textAfter }];
  if (!textBefore.isKnown) {
    return { entries, isBytesMissing: true };
  }
  entries.push({ event, role: EntryRole.RowBefore, bytes: textBefore.text });
  return { entries, isBytesMissing: false };
}

function createOwnState(states: ReverseFileState[], entry: Entry, isModifying: boolean): ReverseFileState {
  return createReverseState(states.length, getOwnStateKind(entry.event), entry.event.instant, entry.bytes, entry.event.source, entry.event.commitHash, isModifying);
}

function isOwnNodeKeptBesideGap(event: FileEvent): boolean {
  return [FileEventType.GitCommit, FileEventType.BackupSnapshot, FileEventType.ReadWhole].includes(event.type);
}

// windowEnd undefined means the window runs to now.
function isScriptEventInWindow(scriptEvents: FileEvent[], windowStart: Date, windowEnd: Date | undefined): boolean {
  for (const scriptEvent of scriptEvents) {
    if (scriptEvent.instant!.getTime() > windowStart.getTime()) {
      if (windowEnd === undefined || scriptEvent.instant!.getTime() < windowEnd.getTime()) {
        return true;
      }
    }
  }
  return false;
}

// A commit is the record of a change, so the difference below a commit needs no gap node; a row explains its own before-text.
function pushStatesForEntry(states: ReverseFileState[], entry: Entry, previous: Entry | undefined, currentBytes: string | undefined, scriptEvents: FileEvent[]): void {
  if (previous === undefined) {
    states.push(createOwnState(states, entry, true));
    return;
  }
  if (entry.bytes === currentBytes) {
    if (entry.role !== EntryRole.RowAfter) {
      states.push(createOwnState(states, entry, false));
    }
    return;
  }
  const isExplained = entry.role === EntryRole.RowBefore || previous.event.type === FileEventType.GitCommit;
  if (isExplained) {
    if (entry.role !== EntryRole.RowAfter) {
      states.push(createOwnState(states, entry, true));
    }
    return;
  }
  let gapKind = ReverseStateKind.UnknownChange;
  if (isScriptEventInWindow(scriptEvents, entry.event.instant!, previous.event.instant)) {
    gapKind = ReverseStateKind.ScriptChange;
  }
  states.push(createReverseState(states.length, gapKind, entry.event.instant, entry.bytes, entry.event.source, undefined, true));
  if (isOwnNodeKeptBesideGap(entry.event)) {
    states.push(createOwnState(states, entry, false));
  }
}

// Turns the events into nodes: a node whose bytes differ from the newer bytes is modifying; every other event still gets a node.
export function createNodesWhenBytesDiffer(events: FileEvent[]): ReverseEventsResult {
  const states: ReverseFileState[] = [];
  const unhandledEvents: FileEvent[] = [];
  const scriptEvents = events.filter((event) => event.type === FileEventType.ScriptReadOnly || event.type === FileEventType.ScriptMayWrite);
  let currentBytes: string | undefined;
  let previous: Entry | undefined;
  for (const [index, event] of events.entries()) {
    if (!isEventTypeHandled(event)) {
      unhandledEvents.push(event);
      const kind = getPassiveStateKind(event);
      states.push(createReverseState(states.length, kind, event.instant, currentBytes, event.source, undefined, kind === ReverseStateKind.PossibleChange));
      continue;
    }
    const expansion = expandEventIntoEntries(events, index, currentBytes);
    for (const entry of expansion.entries) {
      pushStatesForEntry(states, entry, previous, currentBytes, scriptEvents);
      currentBytes = entry.bytes;
      previous = entry;
    }
    if (expansion.isBytesMissing) {
      unhandledEvents.push({ ...event, type: FileEventType.RowBytesUnknown });
      states.push(createReverseState(states.length, ReverseStateKind.PossibleChange, event.instant, currentBytes, event.source, undefined, true));
    }
  }
  return { states, unhandledEvents };
}

export function getReverseStatesForFile(file: Path, jsonlFolders: Path[], snapshotFolders: Path[], transcriptFile: Path = file): ReverseEventsResult {
  const events = getAllEventsForFileFrom(file, transcriptFile, jsonlFolders, snapshotFolders);
  const sortedEvents = sortEventsNewestToOldest(events);
  const result = createNodesWhenBytesDiffer(sortedEvents);
  printUnhandledEvents(result.unhandledEvents);
  return result;
}
