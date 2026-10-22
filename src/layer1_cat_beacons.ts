// Task 355 step 3: a Bash `cat FILE` result acts as a Read-like beacon, never as a change source.

import { getRecordSource } from "./parse/loadTranscript.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import { getToolResultForUserRecord, indexToolUseNamesById, type BashResult } from "./structures/tool-results.ts";
import { BlockType, ToolName } from "./structures/vocabulary.ts";
import type { JsonlRef } from "./layered_types.ts";

export type CatBeacon = { changeId: Uuid; target: Path; instant: Date; content: string; evidence: JsonlRef };

const CAT_COMMAND = /^cat\s+(\S+)\s*$/;
const UNSAFE_ARGUMENT = /[|&;<>$`*?]/;

function indexBashCommandsById(records: TranscriptRecord[]): Map<string, string> {
    const commandById = new Map<string, string>();
    for (const record of records) {
        for (const block of getContentBlocks(record)) {
            if (block.type === BlockType.tool_use && block.name === ToolName.Bash) {
                commandById.set(block.id.toString(), String(block.input.command));
            }
        }
    }
    return commandById;
}

function parseCatArgument(command: string): string | undefined {
    const argument = CAT_COMMAND.exec(command)?.[1];
    if (argument === undefined || argument.startsWith("-") || UNSAFE_ARGUMENT.test(argument)) {
        return undefined;
    }
    return argument;
}

function checkBashRanCleanly(result: BashResult): boolean {
    return !result.interrupted && result.stderr === "" && result.stdout !== "";
}

function buildCatBeacon(
    record: TranscriptRecord,
    commandById: Map<string, string>,
    nameById: Map<string, string>,
    sessionFile: Path,
): CatBeacon | undefined {
    const resultBlock = getContentBlocks(record).find((block) => block.type === BlockType.tool_result);
    const source = getRecordSource(record);
    if (resultBlock === undefined || resultBlock.type !== BlockType.tool_result || source === undefined) {
        return undefined;
    }
    const command = commandById.get(resultBlock.tool_use_id.toString());
    const argument = command === undefined ? undefined : parseCatArgument(command);
    if (argument === undefined) {
        return undefined;
    }
    const resolved = getToolResultForUserRecord(record, nameById);
    if (resolved?.toolName !== ToolName.Bash || !checkBashRanCleanly(resolved.result)) {
        return undefined;
    }
    if (!(record.timestamp instanceof Date)) {
        return undefined;
    }
    return {
        changeId: resultBlock.tool_use_id,
        target: new Path(resolveAgainstCwd(record.cwd, new Path(argument))),
        instant: record.timestamp,
        content: resolved.result.stdout,
        evidence: { sessionFile, line: source.lineNumber },
    };
}

export function collectBashCatBeacons(records: TranscriptRecord[], sessionFile: Path): CatBeacon[] {
    const commandById = indexBashCommandsById(records);
    const nameById = indexToolUseNamesById(records);
    const beacons: CatBeacon[] = [];
    for (const record of records) {
        const beacon = buildCatBeacon(record, commandById, nameById, sessionFile);
        if (beacon !== undefined) {
            beacons.push(beacon);
        }
    }
    return beacons;
}
