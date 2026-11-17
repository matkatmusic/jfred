// Small ripgrep helpers shared by the steps of the layered search.

import { spawnSync } from "node:child_process";
import { Path } from "../src/structures/domain.ts";

export function printProgress(text: string): void {
    process.stderr.write(`\r${text}`);
}

function isNotEmptyText(text: string): boolean {
    return text !== "";
}

export function splitNullSeparatedText(text: string): string[] {
    return text.split("\0").filter(isNotEmptyText);
}

export function assertRipgrepFinished(exitCode: number | null, errorText: string): void {
    // rg exits 1 when nothing matched.
    if (exitCode !== 0) {
        if (exitCode !== 1) {
            throw new Error(`rg failed with exit code ${exitCode}: ${errorText}`);
        }
    }
}

// The first record that has the field wins. Undefined when no record has it (history.jsonl, workflow journals).
export function readFirstTranscriptStringField(transcript: Path, fieldName: string): string | undefined {
    const result = spawnSync("rg", ["-m1", "-o", "--no-filename", "--no-line-number", `"${fieldName}":"[^"]*"`, transcript.toString()], { encoding: "utf8" });
    assertRipgrepFinished(result.status, result.stderr);
    if (result.stdout === "") {
        return undefined;
    }
    return JSON.parse(`{${result.stdout.split("\n")[0]}}`)[fieldName];
}

export function readRequiredTranscriptStringField(transcript: Path, fieldName: string): string {
    const value = readFirstTranscriptStringField(transcript, fieldName);
    if (value === undefined) {
        throw new Error(`${transcript.toString()} has no "${fieldName}" field`);
    }
    return value;
}
