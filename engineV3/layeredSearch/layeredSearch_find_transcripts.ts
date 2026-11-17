// Step A of the layered search: find the logs that mention a file path, with one rg for all paths.

// import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
// import { spawn, spawnSync } from "node:child_process";
// import { mkdirSync, writeFileSync } from "node:fs";
// import { dirname, join } from "node:path";
import type { ProgressSink } from "../../src/parse/loadTranscript.ts";
import { Path } from "../../src/structures/domain.ts";
import { DocumentResponseKind } from "../../src/structures/vocabulary_views.ts";
import { listTranscriptFiles } from "../../src/viewer_api_layer1_sources.ts";
// import { RipgrepSearchMode } from "./layeredSearch_command.ts";
// import { assertRipgrepFinished, printProgress } from "./layeredSearch_ripgrep_helpers.ts";
import { assertRipgrepFinished, splitNullSeparatedText } from "./layeredSearch_ripgrep_helpers.ts";
// import { assertRipgrepFinished, printProgress, splitNullSeparatedText } from "./layeredSearch_ripgrep_helpers.ts";

// const PATTERNS_FILE = join(import.meta.dirname, "..", "..", ".cache", "layeredSearch", "patterns.txt");
const LOG_FILES_PER_SEARCH = 500;

// The per-path version (one rg per path) is off: the one-search version below finds the same logs about 36 times faster.
// function listTranscriptsMentioningEachPathPerPath(files: string[], jsonlsFolders: Path[]): Set<string> {
//     const transcripts = new Set<string>();
//     const startMilliseconds = Date.now();
//     for (const [index, file] of files.entries()) {
//         const result = spawnSync("rg", ["-l", "--null", "-F", "--glob", "*.jsonl", "--", file, ...jsonlsFolders.map(String)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
//         assertRipgrepFinished(result.status, result.stderr);
//         for (const transcript of splitNullSeparatedText(result.stdout)) {
//             transcripts.add(transcript);
//         }
//         printProgress(`A per-path: ${index + 1}/${files.length} paths searched, ${transcripts.size} logs found, ${Date.now() - startMilliseconds} ms`);
//     }
//     process.stderr.write("\n");
//     return transcripts;
// }

// function listTranscriptsMentioningAnyPathAllPaths(files: string[], jsonlsFolders: Path[]): Promise<Set<string>> {
//     mkdirSync(dirname(PATTERNS_FILE), { recursive: true });
//     writeFileSync(PATTERNS_FILE, files.join("\n") + "\n");
//     const transcripts = new Set<string>();
//     const startMilliseconds = Date.now();
//     let unfinishedText = "";
//     let errorText = "";
//     const child = spawn("rg", ["-l", "--null", "-F", "--glob", "*.jsonl", "-f", PATTERNS_FILE, "--", ...jsonlsFolders.map(String)]);
//     child.stdout.setEncoding("utf8");
//     child.stderr.setEncoding("utf8");
//     child.stdout.on("data", (chunk: string) => {
//         const parts = (unfinishedText + chunk).split("\0");
//         unfinishedText = parts.pop() ?? "";
//         for (const transcript of parts) {
//             transcripts.add(transcript);
//         }
//         printProgress(`A all-paths: ${files.length} paths in one search, ${transcripts.size} logs found, ${Date.now() - startMilliseconds} ms`);
//     });
//     child.stderr.on("data", (chunk: string) => {
//         errorText += chunk;
//     });
//     return new Promise((resolvePromise, rejectPromise) => {
//         child.on("error", rejectPromise);
//         child.on("close", (exitCode) => {
//             process.stderr.write("\n");
//             assertRipgrepFinished(exitCode, errorText);
//             resolvePromise(transcripts);
//         });
//     });
// }

function createPathFromText(text: string): Path {
    return new Path(text);
}

// export async function findCandidateTranscripts(files: string[], jsonlsFolders: Path[]): Promise<Path[]> {
//     const transcripts = await listTranscriptsMentioningAnyPathAllPaths(files, jsonlsFolders);
//     return [...transcripts].sort().map(createPathFromText);
// }

export function findCandidateTranscripts(files: string[], jsonlsFolders: Path[], reportProgress: ProgressSink): Path[] {
    // mkdirSync(dirname(PATTERNS_FILE), { recursive: true });
    // writeFileSync(PATTERNS_FILE, files.join("\n") + "\n");
    const logFiles = listTranscriptFiles(jsonlsFolders.map(String));
    const chunkCount = Math.ceil(logFiles.length / LOG_FILES_PER_SEARCH);
    const transcripts = new Set<string>();
    for (let chunkNumber = 1; chunkNumber <= chunkCount; chunkNumber++) {
        const chunkStart = (chunkNumber - 1) * LOG_FILES_PER_SEARCH;
        const chunkLogFiles = logFiles.slice(chunkStart, chunkStart + LOG_FILES_PER_SEARCH);
        // const result = spawnSync("rg", ["-l", "--null", "-F", "-f", PATTERNS_FILE, "--", ...chunkLogFiles.map(String)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
        const result = spawnSync("rg", ["-l", "--null", "-F", "-f", "-", "--", ...chunkLogFiles.map(String)], { encoding: "utf8", input: files.join("\n") + "\n", maxBuffer: 256 * 1024 * 1024 });
        assertRipgrepFinished(result.status, result.stderr);
        for (const transcript of splitNullSeparatedText(result.stdout)) {
            transcripts.add(transcript);
        }
        reportProgress({ kind: DocumentResponseKind.progress, label: `searching logs: ${transcripts.size} logs found`, current: chunkNumber, total: chunkCount });
    }
    return [...transcripts].sort().map(createPathFromText);
}
