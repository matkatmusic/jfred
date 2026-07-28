// Script-file indirection: when a run merely invokes a written script file (`python3 apply.py`, `exec(open("apply.py").read())`), the run's REAL code is the invoked file's authored Write body.  Run detection itself lives in reconstruction_script_execution.ts.

import { BlockType, ToolName } from "./structures/vocabulary.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks, type ContentBlock } from "./structures/content-blocks.ts";
import { singleWhitespace } from "./regex_expressions.ts";
import { ScriptExecutorKind, type ScriptRun } from "./reconstruction_script_execution.ts";

// The final path segment of a "/"-separated path string.
export function pathBasename(value: string): string {
    const slash = value.lastIndexOf("/");
    return slash >= 0 ? value.slice(slash + 1) : value;
}

// One authored Write of a script file: its record instant and body. A file rewritten mid-session (s87's apply_renames.py, written 5×) keeps EVERY body so each run can resolve the one current at its own instant — records load in readdir order, so "first/last seen" is meaningless.
type WrittenScriptBody = { timestamp: Date | undefined; content: string | undefined };

// Every authored Write body per file basename, each stamped with its record instant. One pass over the records — previously every resolved run re-scanned them all.
function recordWrittenContentOfBlock(block: ContentBlock, timestamp: Date | undefined, writtenBodiesByBasename: Map<string, WrittenScriptBody[]>): void {
    if (block.type !== BlockType.tool_use) {
        return;
    }
    if (block.name !== ToolName.Write) {
        return;
    }
    const input = block.input as { file_path?: string; content?: string };
    if (input.file_path === undefined) {
        return;
    }
    const basename = pathBasename(input.file_path);
    const bodies = writtenBodiesByBasename.get(basename);
    if (bodies === undefined) {
        writtenBodiesByBasename.set(basename, [{ timestamp, content: input.content }]);
        return;
    }
    bodies.push({ timestamp, content: input.content });
}

export function indexWrittenContentByBasename(records: TranscriptRecord[]): Map<string, WrittenScriptBody[]> {
    const writtenBodiesByBasename = new Map<string, WrittenScriptBody[]>();
    for (const record of records) {
        for (const block of getContentBlocks(record)) {
            recordWrittenContentOfBlock(block, record.timestamp, writtenBodiesByBasename);
        }
    }
    return writtenBodiesByBasename;
}

// The body current at `when`: the LATEST timestamped Write at or before that instant. When no timestamped Write precedes it (timestamp-less synthetic records), the first recorded body stands in — the retired first-match semantics.
function resolveBodyAtInstant(bodies: WrittenScriptBody[], when: Date): string | undefined {
    let best: WrittenScriptBody | undefined;
    for (const body of bodies) {
        if (body.timestamp === undefined) {
            continue;
        }
        if (body.timestamp.getTime() > when.getTime()) {
            continue;
        }
        if (best === undefined) {
            best = body;
            continue;
        }
        if (body.timestamp.getTime() >= best.timestamp!.getTime()) {
            best = body;
        }
    }
    if (best !== undefined) {
        return best.content;
    }
    return bodies[0]?.content;
}

// The script file extensions we resolve through indirection.
const SCRIPT_EXTENSIONS = [".py", ".sh", ".js", ".ts"];

// Whether a filename ends with a known script extension.
function isScriptFile(name: string): boolean {
    return SCRIPT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// Extract the invoked script filename from a direct-invocation command like `python3 script.py`, `bash script.sh`, `node script.js`, `npx tsx script.ts`.
function parseDirectInvocation(code: string): string | undefined {
    const runners = ["python3", "python", "bash", "sh", "node", "npx tsx"];
    for (const runner of runners) {
        if (!code.includes(runner)) {
            continue;
        }
        const after = code.slice(code.indexOf(runner) + runner.length).trimStart();
        // first word after the runner, e.g. "apply.py --dry-run" -> "apply.py".
        const filename = after.split(singleWhitespace)[0] ?? "";
        if (isScriptFile(filename)) {
            return filename;
        }
    }
    return undefined;
}

// Extract the script filename from an exec(open()) wrapper like `exec(open("rename_inv.py").read())` — the MCP ctx_execute form.
function parseExecOpenIndirection(code: string): string | undefined {
    const marker = 'exec(open("';
    let start = code.indexOf(marker);
    if (start < 0) {
        start = code.indexOf("exec(open('");
        if (start < 0) {
            return undefined;
        }
        start += "exec(open('".length;
    } else {
        start += marker.length;
    }
    const end = code.indexOf('"', start) !== -1 ? code.indexOf('"', start) : code.indexOf("'", start);
    if (end < 0) {
        return undefined;
    }
    const filename = code.slice(start, end);
    return isScriptFile(filename) ? filename : undefined;
}

// Resolve script-file indirection: when a run merely invokes a written script file, replace the run's code with the invoked file's authored Write body CURRENT AT THE RUN'S INSTANT.  Handles two forms: 1. Direct invocation: `python3 script.py`, `bash script.sh`, `node script.js`, `npx tsx script.ts` 2. exec(open()) indirection: MCP ctx_execute wraps a script as `exec(open("file.py").read())` A run that already inlines its code, or whose invoked file has no Write, is returned unchanged.
export function resolveScriptIndirection(run: ScriptRun, writtenBodiesByBasename: Map<string, WrittenScriptBody[]>): ScriptRun {
    const filename = parseDirectInvocation(run.code) ?? parseExecOpenIndirection(run.code);
    if (filename === undefined) {
        return run;
    }
    const bodies = writtenBodiesByBasename.get(pathBasename(filename));
    if (bodies === undefined) {
        return run;
    }
    const body = resolveBodyAtInstant(bodies, run.timestamp);
    if (body === undefined) {
        return run;
    }
    // task 192: a bash run whose invoked file is a written .py body IS python-executable — the s34/s37 `python3 apply.py` mechanism must keep entering the sandbox. Every other substitution keeps the originating tool's kind.
    const resolvesToPython = run.executorKind === ScriptExecutorKind.bash && filename.endsWith(".py");
    const executorKind = resolvesToPython ? ScriptExecutorKind.python : run.executorKind;
    return { ...run, code: body, executorKind };
}
