// The static read-only gate (TASKS.md item 68) plus pre-execution file-state seeding for a run.

import { BlockType, EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { backupSeedWriteFor, type BackupReader } from "./reconstruction_sidecar.ts";
import { relative } from "node:path";
import { quotedFilename, singleWhitespace } from "./regex_expressions.ts";
import {
    fromImportStatementLine,
    importStatementLine,
    openCallToken,
    pythonWritePrimitive,
    readOnlyOpenArgument,
    shellWritePrimitive,
    writingImportedName,
} from "./regex_script_detection.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { buildRenameChain, resolveFinalPath } from "./reconstruction_lineage.ts";
import type { WriteEvent } from "./reconstruction_engine.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { formatRunSource, type ScriptRun } from "./reconstruction_script_execution.ts";
import { pathBasename } from "./reconstruction_script_indirection.ts";
import {
    ReconstructionCounter,
    incrementReconstructionCounter,
} from "./reconstruction_counters.ts";


// Stdlib roots a read-only script may safely import; anything else marks it may-write. Extend freely, missing entries only cost savings.
const READ_ONLY_SAFE_IMPORT_ROOTS = new Set([
    "os", "sys", "re", "json", "csv", "glob", "pathlib", "collections", "itertools",
    "functools", "math", "statistics", "textwrap", "difflib", "datetime", "time", "string",
    "typing", "dataclasses", "enum", "pprint", "fnmatch", "bisect", "heapq", "operator",
    "hashlib", "unicodedata", "copy", "ast", "tokenize", "keyword", "inspect", "traceback",
    "argparse", "random", "io", "base64", "struct", "uuid",
]);

// Whether every import in `code` names only safe stdlib roots, with no from-import smuggling a writing name out.
function allImportsAreReadOnlySafe(code: string): boolean {
    for (const match of code.matchAll(importStatementLine)) {
        for (const item of match[1]!.split(",")) {
            const root = item.trim().split(singleWhitespace)[0]?.split(".")[0] ?? "";
            if (!READ_ONLY_SAFE_IMPORT_ROOTS.has(root)) return false;
        }
    }
    for (const match of code.matchAll(fromImportStatementLine)) {
        const root = match[1]!.split(".")[0] ?? "";
        if (!READ_ONLY_SAFE_IMPORT_ROOTS.has(root)) return false;
        if (writingImportedName.test(match[2]!)) return false;
    }
    return true;
}

// Whether every open( call in `code` is provably read-mode; anything the cheap first-")" parse can't prove counts as may-write.
function allOpenCallsAreReads(code: string): boolean {
    for (const match of code.matchAll(openCallToken)) {
        const argsStart = match.index! + match[0].length;
        const argsEnd = code.indexOf(")", argsStart);
        if (argsEnd < 0) return false;
        const args = code.slice(argsStart, argsEnd);
        // A nested call defeats the first-")" slice — an embedded call could hide a write mode, so bail to may-write.
        if (args.includes("(")) return false;
        const parts = args.split(",");
        const isDotCall = match.index! > 0 && code[match.index! - 1] === ".";
        if (isDotCall) {
            // Path.open(): no arguments defaults to mode "r".
            if (args.trim() === "") continue;
            if (!readOnlyOpenArgument.test(parts[0]!)) return false;
            continue;
        }
        // builtin open(file): a single argument defaults to mode "r".
        if (parts.length === 1) continue;
        if (!readOnlyOpenArgument.test(parts[1]!)) return false;
    }
    return true;
}

// Whether the script could write/delete/rename files; conservative — unparseable code answers may-write. ponytail: raw-text scan, aliased builtins evade it untested.
export function scriptCodeMayWriteFiles(code: string): boolean {
    if (shellWritePrimitive.test(code)) return true;
    if (pythonWritePrimitive.test(code)) return true;
    if (!allImportsAreReadOnlySafe(code)) return true;
    if (!allOpenCallsAreReads(code)) return true;
    return false;
}

function resolvePathByBasename(records: TranscriptRecord[], basename: string): Path | undefined {
    for (const record of records) {
        for (const block of getContentBlocks(record)) {
            if (block.type !== BlockType.tool_use) continue;
            const filePath = (block.input as { file_path?: string }).file_path;
            if (filePath !== undefined && pathBasename(filePath) === basename) return new Path(filePath);
        }
    }
    return undefined;
}


// All file-path-like quoted strings in the script source (e.g. "billing.py", "renames.csv").
export function parseScriptFileRefs(code: string): string[] {
    const matches = code.match(quotedFilename) ?? [];
    return [...new Set(matches.map((m) => m.slice(1, -1)))];
}

// Undefined when the lineage has no revision strictly before that instant.
export type LineageContentBefore = (target: Path, before: Date) => string | undefined;

// The name the script itself uses: cwd-relative when under cwd (so subdirectories survive), else the flat basename.
export function computeScriptStateKey(filePath: Path, runCwd: Path | undefined): string {
    if (runCwd !== undefined) {
        const cwdRelativePath = relative(runCwd.toString(), filePath.toString());
        if (cwdRelativePath !== "" && !cwdRelativePath.startsWith("..")) {
            return cwdRelativePath;
        }
    }
    return pathBasename(filePath.toString());
}

// Every file Written before the run at its rename-resolved name, plus backup-only referenced files, keyed by the script's cwd-relative name.
export function getPreExecutionState(
    run: ScriptRun,
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): Map<string, string> {
    incrementReconstructionCounter(ReconstructionCounter.preStateBuilds);
    reportReconstructionProgress(`building pre-execution state for run @ ${run.timestamp.toISOString()}${formatRunSource(run)}`);
    const events = extractFileEvents(records);
    const renameChain = buildRenameChain(events);
    const state = new Map<string, string>();
    // Task 192 Phase 3: delete+set on replace keeps iteration order matching final-Write order, so colliding paths keep the same winner.
    const latestWritesByCurrentPath = new Map<string, { currentPath: Path; write: WriteEvent }>();
    for (const event of events) {
        if (event.kind !== EventKind.write) continue;
        if (event.timestamp.getTime() > run.timestamp.getTime()) continue;
        const currentPath = resolveFinalPath(event.target, renameChain);
        const pathKey = currentPath.toString();
        latestWritesByCurrentPath.delete(pathKey);
        latestWritesByCurrentPath.set(pathKey, { currentPath, write: event });
    }
    for (const { currentPath, write } of latestWritesByCurrentPath.values()) {
        // Priority order: lineage (post-backup edits, earlier runs), then current-name backup, then rename-source backup, then the authored Write.
        const content = seedContent?.(currentPath, run.timestamp)
            ?? backupSeedWriteFor(records, currentPath, run.timestamp, reader)?.content
            ?? backupSeedWriteFor(records, write.target, run.timestamp, reader)?.content
            ?? write.content;
        state.set(computeScriptStateKey(currentPath, run.cwd), content);
    }
    for (const ref of parseScriptFileRefs(run.code)) {
        if (state.has(ref)) continue;
        const absolutePath = resolvePathByBasename(records, pathBasename(ref));
        if (absolutePath === undefined) continue;
        const content = seedContent?.(absolutePath, run.timestamp)
            ?? backupSeedWriteFor(records, absolutePath, run.timestamp, reader)?.content;
        if (content !== undefined) state.set(ref, content);
    }
    return state;
}
