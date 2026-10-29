// Task 355 step 3: a Bash `cat FILE` result acts as a Read-like beacon, never as a change source.

import { getRecordSource } from "./parse/loadTranscript.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { normalizeAgainstCwd } from "./structures/path-resolve.ts";
import { getToolResultForUserRecord, buildToolUseNamesById } from "./structures/tool-results.ts";
import type { BashResult } from "./structures/tool-result-shapes.ts";
import { BlockType, ToolName } from "./structures/vocabulary.ts";
import type { JsonlRef } from "./layered_types.ts";

export type CatBeacon = { changeId: Uuid; target: Path; instant: Date; content: string; evidence: JsonlRef };

const CAT_COMMAND = /^cat\s+(\S+)\s*$/;
const UNSAFE_ARGUMENT = /[|&;<>$`*?]/;

function buildBashCommandsById(records: TranscriptRecord[]): Map<string, string> {
  const commandById = new Map<string, string>();
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      const isToolUse = block.type === BlockType.tool_use;
      const isBash = isToolUse && block.name === ToolName.Bash;
      if (isBash) {
        commandById.set(block.id.toString(), String(block.input.command));
      }
    }
  }
  return commandById;
}

function parseCatArgument(command: string): string | undefined {
  const argument = CAT_COMMAND.exec(command)?.[1];
  const isMissingArgument = argument === undefined;
  if (isMissingArgument) {
    return undefined;
  }
  const isFlag = argument.startsWith("-");
  const isUnsafe = UNSAFE_ARGUMENT.test(argument);
  const isRejected = isFlag || isUnsafe;
  if (isRejected) {
    return undefined;
  }
  return argument;
}

function isBashCleanRun(result: BashResult): boolean {
  return !result.interrupted && result.stderr === "" && result.stdout !== "";
}

function findToolResultBlock(record: TranscriptRecord) {
  for (const block of getContentBlocks(record)) {
    if (block.type === BlockType.tool_result) {
      return block;
    }
  }
  return undefined;
}

function buildCatBeacon(
  record: TranscriptRecord,
  commandById: Map<string, string>,
  nameById: Map<string, string>,
  sessionFile: Path,
): CatBeacon | undefined {
  const resultBlock = findToolResultBlock(record);
  const source = getRecordSource(record);
  const isMissingResult = resultBlock === undefined;
  const isMissingSource = source === undefined;
  const isMissingPart = isMissingResult || isMissingSource;
  if (isMissingPart) {
    return undefined;
  }
  const command = commandById.get(resultBlock.tool_use_id.toString());
  const argument = command === undefined ? undefined : parseCatArgument(command);
  if (argument === undefined) {
    return undefined;
  }
  const resolved = getToolResultForUserRecord(record, nameById);
  if (resolved?.toolName !== ToolName.Bash) {
    return undefined;
  }
  const isCleanRun = isBashCleanRun(resolved.result);
  if (!isCleanRun) {
    return undefined;
  }
  if (!(record.timestamp instanceof Date)) {
    return undefined;
  }
  return {
    changeId: resultBlock.tool_use_id,
    target: new Path(normalizeAgainstCwd(record.cwd, new Path(argument))),
    instant: record.timestamp,
    content: resolved.result.stdout,
    evidence: { sessionFile, line: source.lineNumber },
  };
}

export function collectBashCatBeacons(records: TranscriptRecord[], sessionFile: Path): CatBeacon[] {
  const commandById = buildBashCommandsById(records);
  const nameById = buildToolUseNamesById(records);
  const beacons: CatBeacon[] = [];
  for (const record of records) {
    const beacon = buildCatBeacon(record, commandById, nameById, sessionFile);
    if (beacon !== undefined) {
      beacons.push(beacon);
    }
  }
  return beacons;
}
