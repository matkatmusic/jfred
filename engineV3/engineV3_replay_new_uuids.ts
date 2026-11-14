// Finds the uuids a recorded Bash call printed for the first time, and gives its replayed command the env that makes randomUUID return them.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Uuid } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { getContentBlocks } from "../src/structures/content-blocks.ts";
import { BlockType } from "../src/structures/vocabulary.ts";
import type { JSONLLine } from "./engineV3.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import type { ReportPhaseProgress } from "./engineV3_startup_progress.ts";

// crypto.randomUUID makes only lowercase version 4 uuids.
const RANDOM_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const PRELOAD_FILE = fileURLToPath(new URL("./engineV3_recorded_uuids_preload.cjs", import.meta.url));

export function listUuidsInText(text: string): Uuid[] {
    const uuidTexts = new Set(text.match(RANDOM_UUID_PATTERN));
    const uuids: Uuid[] = [];
    for (const uuidText of uuidTexts) {
        uuids.push(new Uuid(uuidText));
    }
    return uuids;
}

// File path, then line number, then the line's position in the replay's merged line list.
function mapLinePositions(jsonlLines: JSONLLine[]): Map<string, Map<number, number>> {
    const linePositions = new Map<string, Map<number, number>>();
    for (const [position, line] of jsonlLines.entries()) {
        const source = getRecordSource(line);
        if (source === undefined) {
            throw new Error("mapLinePositions: a JSONL line has no source file and line number");
        }
        let filePositions = linePositions.get(source.filePath);
        if (filePositions === undefined) {
            filePositions = new Map<number, number>();
            linePositions.set(source.filePath, filePositions);
        }
        filePositions.set(source.lineNumber, position);
    }
    return linePositions;
}

function keepEarlierPosition(earliestPositions: Map<string, number>, uuidText: string, position: number): void {
    const knownPosition = earliestPositions.get(uuidText);
    if (knownPosition === undefined) {
        earliestPositions.set(uuidText, position);
        return;
    }
    if (position < knownPosition) {
        earliestPositions.set(uuidText, position);
    }
}

// The index lines hold no full text, so each file is read once more and scanned for the candidate uuids.
function findEarliestPositions(jsonlLines: JSONLLine[], candidateUuidTexts: Set<string>, reportProgress: ReportPhaseProgress): Map<string, number> {
    const linePositions = mapLinePositions(jsonlLines);
    const earliestPositions = new Map<string, number>();
    let doneFileCount = 0;
    for (const [filePath, filePositions] of linePositions) {
        const lineTexts = readFileSync(filePath, "utf8").split("\n");
        for (const [lineNumber, position] of filePositions) {
            const lineText = lineTexts[lineNumber - 1] as string;
            for (const uuidText of lineText.match(RANDOM_UUID_PATTERN) ?? []) {
                if (candidateUuidTexts.has(uuidText)) {
                    keepEarlierPosition(earliestPositions, uuidText, position);
                }
            }
        }
        doneFileCount += 1;
        reportProgress(doneFileCount, linePositions.size);
    }
    return earliestPositions;
}

// A uuid is new at a call when no line before the call line holds it, and no earlier call was given it.
function listNewUuidsOfCall(result: BashCallResult, callPosition: number, earliestPositions: Map<string, number>, handedOutUuidTexts: Set<string>): Uuid[] {
    const newUuids: Uuid[] = [];
    for (const uuid of listUuidsInText(result.resultText)) {
        const earliestPosition = earliestPositions.get(uuid.toString());
        if (earliestPosition === undefined) {
            throw new Error(`listNewUuidsOfCall: no JSONL line holds uuid ${uuid.toString()} from the result of Bash call ${result.toolUseId.toString()}`);
        }
        if (earliestPosition > callPosition) {
            if (!handedOutUuidTexts.has(uuid.toString())) {
                handedOutUuidTexts.add(uuid.toString());
                newUuids.push(uuid);
            }
        }
    }
    return newUuids;
}

// Keyed by tool_use id text; a call whose recorded output holds no new uuid gets no entry.
export function collectNewOutputUuids(jsonlLines: JSONLLine[], bashCallResults: Map<string, BashCallResult>, reportProgress: ReportPhaseProgress): Map<string, Uuid[]> {
    const candidateUuidTexts = new Set<string>();
    for (const result of bashCallResults.values()) {
        for (const uuid of listUuidsInText(result.resultText)) {
            candidateUuidTexts.add(uuid.toString());
        }
    }
    const earliestPositions = findEarliestPositions(jsonlLines, candidateUuidTexts, reportProgress);
    const handedOutUuidTexts = new Set<string>();
    const newOutputUuids = new Map<string, Uuid[]>();
    for (const [position, line] of jsonlLines.entries()) {
        if (line.timestamp instanceof Date) {
            for (const block of getContentBlocks(line)) {
                if (block.type === BlockType.tool_use) {
                    const result = bashCallResults.get(block.id.toString());
                    if (result !== undefined) {
                        const newUuids = listNewUuidsOfCall(result, position, earliestPositions, handedOutUuidTexts);
                        if (newUuids.length > 0) {
                            newOutputUuids.set(block.id.toString(), newUuids);
                        }
                    }
                }
            }
        }
    }
    return newOutputUuids;
}

function appendOption(existingOptions: string | undefined, option: string): string {
    if (existingOptions === undefined) {
        return option;
    }
    return `${existingOptions} ${option}`;
}

// A call with no new uuid gets no env, so it runs exactly as before; bun's options cannot quote a path, node's can.
export function getRecordedUuidEnv(newUuids: Uuid[] | undefined): Record<string, string> {
    if (newUuids === undefined) {
        return {};
    }
    const uuidTexts: string[] = [];
    for (const uuid of newUuids) {
        uuidTexts.push(uuid.toString());
    }
    return {
        ENGINEV3_RECORDED_UUIDS: uuidTexts.join(","),
        ENGINEV3_RECORDED_UUID_CLAIMS_FOLDER: mkdtempSync(join(tmpdir(), "engineV3-uuid-claims-")),
        BUN_OPTIONS: appendOption(process.env.BUN_OPTIONS, `--preload=${PRELOAD_FILE}`),
        NODE_OPTIONS: appendOption(process.env.NODE_OPTIONS, `--require "${PRELOAD_FILE}"`),
    };
}
