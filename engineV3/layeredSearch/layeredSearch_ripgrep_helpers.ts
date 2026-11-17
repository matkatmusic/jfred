// Small ripgrep helpers shared by the steps of the layered search.

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { relative } from "node:path";
import { Path } from "../../src/structures/domain.ts";

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

// One rg over the whole folder: the first value of the field in each log that has it.
export function readFirstStringFieldOfAllTranscripts(jsonlsFolders: Path[], fieldName: string): Map<string, string> {
    const result = spawnSync("rg", ["-m1", "-o", "--with-filename", "--null", "--no-line-number", "--glob", "*.jsonl", `"${fieldName}":"[^"]*"`, ...jsonlsFolders.map(String)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    assertRipgrepFinished(result.status, result.stderr);
    const valuesByTranscript = new Map<string, string>();
    for (const line of result.stdout.split("\n")) {
        if (line !== "") {
            const separatorIndex = line.indexOf("\0");
            const transcript = line.slice(0, separatorIndex);
            const match = line.slice(separatorIndex + 1);
            if (!valuesByTranscript.has(transcript)) {
                valuesByTranscript.set(transcript, JSON.parse(`{${match}}`)[fieldName]);
            }
        }
    }
    return valuesByTranscript;
}

function escapeRegexCharacters(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The project folder as the log can spell it: absolute, `~/...` and `$HOME/...` (the last two only inside the home folder).
function listProjectFolderSpellings(projectFolderText: string): string[] {
    const spellings = [projectFolderText];
    const homeRelativePath = relative(homedir(), projectFolderText);
    if (homeRelativePath !== "") {
        if (!homeRelativePath.startsWith("..")) {
            spellings.push(`~/${homeRelativePath}`);
            spellings.push(`$HOME/${homeRelativePath}`);
        }
    }
    return spellings;
}

// Each spelling must not run on into a longer name: /x/jot matches /x/jot/a and "/x/jot", not /x/jot-recovery or /x/jotter.
export function buildProjectFolderRegex(projectFolder: Path): string {
    const projectFolderText = projectFolder.toString().replace(/\/$/, "");
    const escapedSpellings = listProjectFolderSpellings(projectFolderText).map(escapeRegexCharacters);
    return `(?:${escapedSpellings.join("|")})(?:[^A-Za-z0-9_-]|$)`;
}

// One rg over the whole folder: the logs that name the project folder anywhere (user ruling: wide search).
export function listTranscriptsNamingProjectFilePaths(jsonlsFolders: Path[], projectFolder: Path): Set<string> {
    // const projectFolderText = projectFolder.toString().replace(/\/$/, "");
    // const result = spawnSync("rg", ["-l", "--null", "-F", "--glob", "*.jsonl", "-e", `"file_path":"${projectFolderText}/`, "--", ...jsonlsFolders.map(String)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const result = spawnSync("rg", ["-l", "--null", "--glob", "*.jsonl", "-e", buildProjectFolderRegex(projectFolder), "--", ...jsonlsFolders.map(String)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    assertRipgrepFinished(result.status, result.stderr);
    return new Set(splitNullSeparatedText(result.stdout));
}

export function readRequiredTranscriptStringField(transcript: Path, fieldName: string): string {
    const value = readFirstTranscriptStringField(transcript, fieldName);
    if (value === undefined) {
        throw new Error(`${transcript.toString()} has no "${fieldName}" field`);
    }
    return value;
}
