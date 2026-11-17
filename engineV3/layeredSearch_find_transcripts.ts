// Step A of the layered search: find the logs that mention a file path, with one rg per path or one rg for all paths.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { RipgrepSearchMode } from "./layeredSearch_command.ts";
import { assertRipgrepFinished, printProgress, splitNullSeparatedText } from "./layeredSearch_ripgrep_helpers.ts";

const PATTERNS_FILE = join(import.meta.dirname, "..", ".cache", "layeredSearch", "patterns.txt");

function listTranscriptsMentioningEachPathPerPath(files: string[], jsonlsFolder: Path): Set<string> {
    const transcripts = new Set<string>();
    const startMilliseconds = Date.now();
    for (const [index, file] of files.entries()) {
        const result = spawnSync("rg", ["-l", "--null", "-F", "--glob", "*.jsonl", "--", file, jsonlsFolder.toString()], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
        assertRipgrepFinished(result.status, result.stderr);
        for (const transcript of splitNullSeparatedText(result.stdout)) {
            transcripts.add(transcript);
        }
        printProgress(`A per-path: ${index + 1}/${files.length} paths searched, ${transcripts.size} logs found, ${Date.now() - startMilliseconds} ms`);
    }
    process.stderr.write("\n");
    return transcripts;
}

function listTranscriptsMentioningAnyPathAllPaths(files: string[], jsonlsFolder: Path): Promise<Set<string>> {
    mkdirSync(dirname(PATTERNS_FILE), { recursive: true });
    writeFileSync(PATTERNS_FILE, files.join("\n") + "\n");
    const transcripts = new Set<string>();
    const startMilliseconds = Date.now();
    let unfinishedText = "";
    let errorText = "";
    const child = spawn("rg", ["-l", "--null", "-F", "--glob", "*.jsonl", "-f", PATTERNS_FILE, "--", jsonlsFolder.toString()]);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
        const parts = (unfinishedText + chunk).split("\0");
        unfinishedText = parts.pop() ?? "";
        for (const transcript of parts) {
            transcripts.add(transcript);
        }
        printProgress(`A all-paths: ${files.length} paths in one search, ${transcripts.size} logs found, ${Date.now() - startMilliseconds} ms`);
    });
    child.stderr.on("data", (chunk: string) => {
        errorText += chunk;
    });
    return new Promise((resolvePromise, rejectPromise) => {
        child.on("error", rejectPromise);
        child.on("close", (exitCode) => {
            process.stderr.write("\n");
            assertRipgrepFinished(exitCode, errorText);
            resolvePromise(transcripts);
        });
    });
}

function createPathFromText(text: string): Path {
    return new Path(text);
}

export async function findCandidateTranscripts(files: string[], jsonlsFolder: Path, ripgrepSearchMode: RipgrepSearchMode): Promise<Path[]> {
    let transcripts = new Set<string>();
    if (ripgrepSearchMode === RipgrepSearchMode.PerPath) {
        transcripts = listTranscriptsMentioningEachPathPerPath(files, jsonlsFolder);
    }
    if (ripgrepSearchMode === RipgrepSearchMode.AllPaths) {
        transcripts = await listTranscriptsMentioningAnyPathAllPaths(files, jsonlsFolder);
    }
    return [...transcripts].sort().map(createPathFromText);
}
