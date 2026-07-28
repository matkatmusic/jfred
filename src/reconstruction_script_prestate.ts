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


// Python stdlib roots a read-only analysis script may import without becoming a writer. Any
// other import marks the script may-write: a seeded local module can run write code at import
// time (the s34 script-indirection family), and shutil/subprocess/sqlite3 write outright.
// A missing safe module only costs sandbox savings, never correctness — extend freely.
const READ_ONLY_SAFE_IMPORT_ROOTS = new Set([
    "os", "sys", "re", "json", "csv", "glob", "pathlib", "collections", "itertools",
    "functools", "math", "statistics", "textwrap", "difflib", "datetime", "time", "string",
    "typing", "dataclasses", "enum", "pprint", "fnmatch", "bisect", "heapq", "operator",
    "hashlib", "unicodedata", "copy", "ast", "tokenize", "keyword", "inspect", "traceback",
    "argparse", "random", "io", "base64", "struct", "uuid",
]);

// Whether every import statement in `code` names only read-only-safe stdlib roots, and no
// from-import smuggles a writing name (`from os import remove`) out of a safe root.
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

// Whether every open( call in `code` is provably a read: builtin open with one argument or a
// read-mode/keyword second argument; a dot-call (Path.open, io.open) must show a read mode or
// keyword-only args as its FIRST argument (Path.open's first parameter IS the mode). Anything
// the cheap first-")" parse cannot prove (nested calls, variable modes) counts as may-write.
function allOpenCallsAreReads(code: string): boolean {
    for (const match of code.matchAll(openCallToken)) {
        const argsStart = match.index! + match[0].length;
        const argsEnd = code.indexOf(")", argsStart);
        if (argsEnd < 0) return false;
        const args = code.slice(argsStart, argsEnd);
        // A nested call defeats the first-")" slice (an f-string's embedded call can even
        // hide a write mode past it) — bail to may-write.
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

// Whether the script could write, delete, rename, or create files when run under the python3
// sandbox. Conservative by construction: any unparseable construct answers true (may-write),
// which merely executes the run as before the gate; only a provably-read-only script answers
// false. Shell write verbs and file redirects classify may-write too (task 139) — that fixes
// the item-69 consent LABEL, not reconstruction correctness: a shell line crashes the python3
// sandbox and yields post:undefined either way (rename evidence comes from the dedicated
// rename extraction).
// ponytail: raw-text scan — aliased builtins (`o = open`) and getattr tricks evade it; no
// recorded transcript uses them, and task 67's executed-outcome check is the exact answer.
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

// The name the script itself uses: cwd-relative when the file lives under cwd (so subdirectories
// survive), else the flat basename.
export function computeScriptStateKey(filePath: Path, runCwd: Path | undefined): string {
    if (runCwd !== undefined) {
        const cwdRelativePath = relative(runCwd.toString(), filePath.toString());
        if (cwdRelativePath !== "" && !cwdRelativePath.startsWith("..")) {
            return cwdRelativePath;
        }
    }
    return pathBasename(filePath.toString());
}

// Every file Written before the run at its rename-resolved current name, plus any file the script
// references that only a backup knows, keyed by the name the script uses from its cwd.
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
    // Task 192 Phase 3: the delete+set on replace keeps iteration order equal to each path's
    // final-Write order, so two paths collapsing to one state key keep the same winner.
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
        // Lineage first (it carries post-backup Edits and earlier runs' effects); then the
        // backup at the current name; then the rename source's backup; then the authored Write.
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
