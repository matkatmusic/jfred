// Copies the idle-state hook files (<project>/.idleState/*) that no recorded Write/Edit creates, at their Mac mtime.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { BlockType } from "../src/structures/vocabulary.ts";
import { TimelineEventKind, type JSONLLine, type TimelineEvent } from "./engineV3.ts";
import { writeFileIntoState } from "./engineV3_replay_submodule.ts";
import { getBlocksOfTimedLine, isWriteOrEditName } from "./engineV3_replay_tool_results.ts";

export type IdleStateCopy = { macFile: Path; targetPath: Path; timeMs: number };

const IDLE_STATE_FOLDER_NAME = ".idleState";
const PLATE_FOLDER_NAME = ".plate";
const PARENT_FOLDER_PREFIX = "..";

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

function addIdleStateFolderFiles(idleStateFolder: string, macFiles: string[]): void {
  for (const entry of readdirSync(idleStateFolder, { withFileTypes: true })) {
    if (entry.isFile()) {
      macFiles.push(join(idleStateFolder, entry.name));
    }
  }
}

function listMacIdleStateFiles(folder: string, macFiles: string[]): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === IDLE_STATE_FOLDER_NAME) {
      addIdleStateFolderFiles(join(folder, entry.name), macFiles);
    }
    else if (entry.name !== PLATE_FOLDER_NAME) {
      if (entry.isDirectory()) {
        listMacIdleStateFiles(join(folder, entry.name), macFiles);
      }
    }
  }
}

// The Mac folder sits under macPlatePath at the project's absolute path, like the plate captures.
export function listIdleStateCopies(macPlatePath: Path, lines: JSONLLine[]): IdleStateCopy[] {
  const macFiles: string[] = [];
  listMacIdleStateFiles(macPlatePath.toString(), macFiles);
  const recordedPaths = listRecordedWritePaths(lines);
  const copies: IdleStateCopy[] = [];
  for (const macFile of macFiles) {
    const targetPath = new Path("/" + relative(macPlatePath.toString(), macFile));
    if (!recordedPaths.has(targetPath.toString())) {
      copies.push({ macFile: new Path(macFile), targetPath, timeMs: Math.floor(statSync(macFile).mtimeMs) });
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
  return `idle-state file ${copy.targetPath.toString()} copied from the Mac at ${new Date(copy.timeMs).toISOString()}`;
}

export function applyIdleStateCopyToState(state: Path, copy: IdleStateCopy): void {
  const relativeTarget = relative(state.toString(), copy.targetPath.toString());
  if (relativeTarget.startsWith(PARENT_FOLDER_PREFIX)) {
    throw new Error(`applyIdleStateCopyToState: ${copy.targetPath.toString()} is outside the state folder ${state.toString()}`);
  }
  writeFileIntoState(state, new Path(relativeTarget), readFileSync(copy.macFile.toString()));
}
