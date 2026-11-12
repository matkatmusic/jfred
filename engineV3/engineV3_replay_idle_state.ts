// Copies the idle-state hook files (<project>/.idleState/*) and the playground results files (<project>/playground/results/*) that no recorded call makes, at their Mac mtime.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { BlockType, EXECUTOR_TOOL_NAMES, ToolName } from "../src/structures/vocabulary.ts";
import { TimelineEventKind, type JSONLLine, type TimelineEvent } from "./engineV3.ts";
import { PLAYGROUND_HISTORY_PATH } from "./engineV3_replay_start_files.ts";
import type { PrintLine } from "./engineV3_startup_progress.ts";
import { writeFileIntoState } from "./engineV3_replay_submodule.ts";
import { getBlocksOfTimedLine, isWriteOrEditName } from "./engineV3_replay_tool_results.ts";

export type IdleStateCopy = { macFile: Path; targetPath: Path; timeMs: number; folderLabel: string };

type MacFile = { path: string; folderLabel: string };
type RecordedUse = { firstUseMs: number; writtenByCommand: boolean };

const IDLE_STATE_FOLDER_NAME = ".idleState";
const IDLE_STATE_LABEL = "idle-state";
const PLAYGROUND_FOLDER_NAME = "playground";
const RESULTS_FOLDER_NAME = "results";
const RESULTS_LABEL = "results";
const PLATE_FOLDER_NAME = ".plate";
const PARENT_FOLDER_PREFIX = "..";
// A redirect to a file, tee, cp, mv, rm, touch, sed -i, a file-write call, or curl -o; an unsure match counts as a write.
const COMMAND_WRITE_PATTERN = /(?:^|[\s&0-9])>>?\s*(?![=&]|\/dev\/null)\S|\btee\b|\bcp\b|\bmv\b|\brm\b|\btouch\b|\bsed\s+-i|writeFile|Bun\.write|\bcurl\b[^|;\n]*\s-o\s/;
const READER_TOOL_NAMES = new Set<string>([...EXECUTOR_TOOL_NAMES, ToolName.Read, ToolName.Grep]);

function listRecordedWritePaths(lines: JSONLLine[]): Set<string> {
  const recordedPaths = new Set<string>();
  for (const line of lines) {
    for (const block of getBlocksOfTimedLine(line)) {
      if (block.type === BlockType.tool_use) {
        if (isWriteOrEditName(block.name)) {
          const input = block.input as { file_path?: string; path?: string };
          const filePath = input.file_path ?? input.path;
          if (filePath === undefined) {
            throw new Error(`listRecordedWritePaths: tool_use ${block.id.toString()} has no file_path`);
          }
          recordedPaths.add(filePath);
        }
      }
    }
  }
  return recordedPaths;
}

function getToolCallText(input: Record<string, unknown>): string {
  return Object.values(input).filter((value): value is string => typeof value === "string").join("\n");
}

// Per file name: the time of the first recorded Bash/Read/Grep call naming it, and whether a recorded command that names it also writes.
function listRecordedUses(lines: JSONLLine[], fileNames: string[]): Map<string, RecordedUse> {
  const recordedUses = new Map<string, RecordedUse>();
  for (const line of lines) {
    for (const block of getBlocksOfTimedLine(line)) {
      if (block.type === BlockType.tool_use) {
        if (READER_TOOL_NAMES.has(block.name)) {
          const text = getToolCallText(block.input as Record<string, unknown>);
          const callTimeMs = (line.timestamp as Date).getTime();
          for (const fileName of fileNames) {
            if (text.includes(fileName)) {
              const earlierUse = recordedUses.get(fileName);
              const firstUseMs = earlierUse === undefined ? callTimeMs : Math.min(earlierUse.firstUseMs, callTimeMs);
              const writtenByCommand = earlierUse?.writtenByCommand === true || (EXECUTOR_TOOL_NAMES.has(block.name) && COMMAND_WRITE_PATTERN.test(text));
              recordedUses.set(fileName, { firstUseMs, writtenByCommand });
            }
          }
        }
      }
    }
  }
  return recordedUses;
}

function addFolderFiles(folder: string, folderLabel: string, macFiles: MacFile[]): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isFile()) {
      macFiles.push({ path: join(folder, entry.name), folderLabel });
    }
  }
}

function isPlaygroundResultsFolder(parentFolder: string, folderName: string): boolean {
  if (folderName === RESULTS_FOLDER_NAME) {
    return basename(parentFolder) === PLAYGROUND_FOLDER_NAME;
  }
  return false;
}

function listMacFiles(folder: string, macFiles: MacFile[]): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === IDLE_STATE_FOLDER_NAME) {
      addFolderFiles(join(folder, entry.name), IDLE_STATE_LABEL, macFiles);
    }
    else if (isPlaygroundResultsFolder(folder, entry.name)) {
      addFolderFiles(join(folder, entry.name), RESULTS_LABEL, macFiles);
    }
    else if (entry.name !== PLATE_FOLDER_NAME) {
      if (entry.isDirectory()) {
        listMacFiles(join(folder, entry.name), macFiles);
      }
    }
  }
}

// A results file is copied only if no recorded command made it, the start state does not write it, and it did not change after its first recorded use.
function shouldCopyMacFile(folderLabel: string, targetPath: Path, timeMs: number, recordedUses: Map<string, RecordedUse>, printLine: PrintLine): boolean {
  if (folderLabel === IDLE_STATE_LABEL) {
    return true;
  }
  if (targetPath.toString().endsWith("/" + PLAYGROUND_HISTORY_PATH)) {
    return false;
  }
  const recordedUse = recordedUses.get(basename(targetPath.toString()));
  if (recordedUse === undefined) {
    return true;
  }
  if (recordedUse.writtenByCommand) {
    return false;
  }
  if (timeMs > recordedUse.firstUseMs) {
    printLine(`results file ${targetPath.toString()} changed after its first recorded use at ${new Date(recordedUse.firstUseMs).toISOString()}: not copied`);
    return false;
  }
  return true;
}

// The Mac folder sits under macPlatePath at the project's absolute path, like the plate captures.
export function listIdleStateCopies(macPlatePath: Path, lines: JSONLLine[], printLine: PrintLine = console.log): IdleStateCopy[] {
  const macFiles: MacFile[] = [];
  listMacFiles(macPlatePath.toString(), macFiles);
  const recordedPaths = listRecordedWritePaths(lines);
  const resultsFileNames = macFiles.filter((macFile) => macFile.folderLabel === RESULTS_LABEL).map((macFile) => basename(macFile.path));
  const recordedUses = listRecordedUses(lines, resultsFileNames);
  const copies: IdleStateCopy[] = [];
  for (const macFile of macFiles) {
    const targetPath = new Path("/" + relative(macPlatePath.toString(), macFile.path));
    if (!recordedPaths.has(targetPath.toString())) {
      const timeMs = Math.floor(statSync(macFile.path).mtimeMs);
      if (shouldCopyMacFile(macFile.folderLabel, targetPath, timeMs, recordedUses, printLine)) {
        copies.push({ macFile: new Path(macFile.path), targetPath, timeMs, folderLabel: macFile.folderLabel });
      }
    }
  }
  return copies;
}

// A tie keeps the earlier list first; with no Mac plate folder there are no idle-state events.
export function mergeIdleStateEventsIntoActions(actionEvents: TimelineEvent[], macPlatePath: Path | undefined, lines: JSONLLine[]): TimelineEvent[] {
  const events = [...actionEvents];
  if (macPlatePath !== undefined) {
    for (const copy of listIdleStateCopies(macPlatePath, lines)) {
      events.push({ type: TimelineEventKind.IdleStateCopy, copy, timestamp: copy.timeMs });
    }
  }
  return events.sort((first, second) => first.timestamp - second.timestamp);
}

export function formatIdleStateCopyText(copy: IdleStateCopy): string {
  return `${copy.folderLabel} file ${copy.targetPath.toString()} copied from the Mac at ${new Date(copy.timeMs).toISOString()}`;
}

export function applyIdleStateCopyToState(state: Path, copy: IdleStateCopy): void {
  const relativeTarget = relative(state.toString(), copy.targetPath.toString());
  if (relativeTarget.startsWith(PARENT_FOLDER_PREFIX)) {
    throw new Error(`applyIdleStateCopyToState: ${copy.targetPath.toString()} is outside the state folder ${state.toString()}`);
  }
  writeFileIntoState(state, new Path(relativeTarget), readFileSync(copy.macFile.toString()));
}
