// Script-execution replay: event types, run detection, and indirection resolution. The pre-execution
// analysis/state seeding lives in reconstruction_script_prestate.ts, the sandbox execution + memo in
// reconstruction_script_sandbox.ts, and the validation/injection stage in reconstruction_script_stage.ts.

import { BlockType, EventKind, EXECUTOR_TOOL_NAMES, ToolName } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks, type ContentBlock, type ToolUseBlock } from "./structures/content-blocks.ts";
import { singleWhitespace } from "./regex_expressions.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";
import { formatRecordSourceToken, getRecordSource, type RecordSource } from "./parse/loadTranscript.ts";

// The proven post-execution state of a script run for one target file: the forward transform already
// applied to the pre-script content. Injected as a synthetic authored event at the run's timestamp and
// replayed as a full-content revision (like userEdit / overwrite). `content` is precomputed (not subs
// re-applied at replay) so the revision is independent of replay ordering / earlier beacon completion.
// One event per target file.
export type ScriptExecutionEvent = {
    kind: EventKind.scriptExecution;
    changeId: Uuid;
    target: Path;
    content: string;
    timestamp: Date;
};

// --- run detection ----------------------------------------------------------------------------------

// A recorded script-execution run: the script source it ran, when, the directory it ran from
// (the MCP executor's input.cwd when present, else the record's cwd), the transcript
// file:line the run was parsed from (absent for synthetic test records), and the id of the
// tool_use block that produced the run (absent for synthetic runs) — the session-attributable
// source a synthetic script-execution changeId embeds.
export type ScriptRun = { code: string; timestamp: Date; cwd?: Path; source?: RecordSource; toolUseId?: Uuid };

// Prefix marking a synthetic script-execution changeId. Follows the originalFile: precedent
// (reconstruction_reseed.ts): a prefixed id that resolveSyntheticChangeIdToSourceId can unwrap.
export const SCRIPT_RUN_CHANGE_ID_PREFIX = "scriptRun:";

// Deterministic changeId for a synthetic script-execution event. Both the step-timeline replay
// and the file-history replay derive it from the same records, so their events join — the fix
// for per-replay randomUUID ids that could never match (TASKS.md item 34). The source segment
// (tool_use id, or epoch-ms timestamp for a run no tool_use produced) never contains ":", so
// the first ":" after the prefix always terminates it even when the target path is unusual.
export function computeScriptExecutionChangeId(run: ScriptRun, target: Path): Uuid {
    const sourceSegment = run.toolUseId?.toString() ?? String(run.timestamp.getTime());
    return new Uuid(`${SCRIPT_RUN_CHANGE_ID_PREFIX}${sourceSegment}:${target.toString()}`);
}

// The session-attributable source id inside a scriptRun: changeId, or undefined when the id is
// not a scriptRun: id (real record uuids, originalFile: seeds, and blob refs pass through).
export function resolveScriptRunChangeIdToSourceId(changeId: string): string | undefined {
    if (!changeId.startsWith(SCRIPT_RUN_CHANGE_ID_PREFIX)) {
        return undefined;
    }
    const rest = changeId.slice(SCRIPT_RUN_CHANGE_ID_PREFIX.length);
    const separatorIndex = rest.indexOf(":");
    return separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
}

// " [file.jsonl:123]" for a run parsed from a transcript line, or "" for a synthetic run —
// appended to progress labels so a console line points at the exact JSONL line being processed.
export function formatRunSource(run: ScriptRun): string {
    return formatRecordSourceToken(run.source);
}

// The runnable source a script-execution block carries: `input.code` (MCP execute) or `input.command`
// (Bash). undefined for a non-executor tool, or an executor carrying neither.
function scriptCodeOf(block: ToolUseBlock): string | undefined {
    if (!EXECUTOR_TOOL_NAMES.has(block.name)) {
        return undefined;
    }
    const input = block.input as { code?: string; command?: string };
    return input.code ?? input.command;
}

// True when a tool_use is a script-execution run (a Bash or MCP-execution tool carrying script source).
export function isScriptExecutionRun(block: ToolUseBlock): boolean {
    return scriptCodeOf(block) !== undefined;
}

// The script-execution runs carried by one record's tool_use blocks (at the record's timestamp).
function runsInRecord(record: TranscriptRecord): ScriptRun[] {
    const timestamp = record.timestamp;
    if (!(timestamp instanceof Date)) {
        return [];
    }
    const recordCwd = (record as { cwd?: Path }).cwd;
    const source = getRecordSource(record);
    const runs: ScriptRun[] = [];
    for (const block of getContentBlocks(record)) {
        if (block.type !== BlockType.tool_use) {
            continue;
        }
        const code = scriptCodeOf(block);
        if (code !== undefined) {
            const blockCwd = (block.input as { cwd?: string }).cwd;
            const cwd = blockCwd !== undefined ? new Path(blockCwd) : recordCwd;
            runs.push({ code, timestamp, cwd, source, toolUseId: block.id });
        }
    }
    return runs;
}

// The authored Write body for every file basename, first Write wins (same first-match
// semantics as the retired per-basename scan, including a matching Write with an absent
// content). One pass over the records — previously every resolved run re-scanned them all.
function recordWrittenContentOfBlock(block: ContentBlock, writtenBodyByBasename: Map<string, string | undefined>): void {
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
    if (!writtenBodyByBasename.has(basename)) {
        writtenBodyByBasename.set(basename, input.content);
    }
}

function indexWrittenContentByBasename(records: TranscriptRecord[]): Map<string, string | undefined> {
    const writtenBodyByBasename = new Map<string, string | undefined>();
    for (const record of records) {
        for (const block of getContentBlocks(record)) {
            recordWrittenContentOfBlock(block, writtenBodyByBasename);
        }
    }
    return writtenBodyByBasename;
}

// Resolve script-file indirection: when a run merely invokes a written script file, replace
// the run's code with the invoked file's authored Write body. Handles two forms:
//   1. Direct invocation: `python3 script.py`, `bash script.sh`, `node script.js`, `npx tsx script.ts`
//   2. exec(open()) indirection: MCP ctx_execute wraps a script as `exec(open("file.py").read())`
// A run that already inlines its code, or whose invoked file has no Write, is returned unchanged.
// The script file extensions we resolve through indirection.
const SCRIPT_EXTENSIONS = [".py", ".sh", ".js", ".ts"];

// Whether a filename ends with a known script extension.
function isScriptFile(name: string): boolean {
    return SCRIPT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// Extract the invoked script filename from a direct-invocation command like
// `python3 script.py`, `bash script.sh`, `node script.js`, `npx tsx script.ts`.
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

// Extract the script filename from an exec(open()) wrapper like
// `exec(open("rename_inv.py").read())` — the MCP ctx_execute form.
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

function resolveScriptIndirection(run: ScriptRun, writtenBodyByBasename: Map<string, string | undefined>): ScriptRun {
    const filename = parseDirectInvocation(run.code) ?? parseExecOpenIndirection(run.code);
    if (filename === undefined) {
        return run;
    }
    const body = writtenBodyByBasename.get(pathBasename(filename));
    return body === undefined ? run : { ...run, code: body };
}

// Every script-execution run in the transcript, in record order, each with its source and timestamp.
// A run that invokes a written script file is resolved to that file's body (resolveScriptIndirection).
// Memoized per records identity in the corpus (pure group): the result depends on the records alone,
// and the per-file repair chain calls this once per reconstructed file.
export function findScriptExecutionRuns(records: TranscriptRecord[]): ScriptRun[] {
    const state = getCorpusState(records);
    if (state.scriptRuns !== undefined) {
        return state.scriptRuns;
    }
    const writtenBodyByBasename = indexWrittenContentByBasename(records);
    state.scriptRuns = records.flatMap(runsInRecord).map((run) => resolveScriptIndirection(run, writtenBodyByBasename));
    return state.scriptRuns;
}

// The final path segment of a "/"-separated path string.
export function pathBasename(value: string): string {
    const slash = value.lastIndexOf("/");
    return slash >= 0 ? value.slice(slash + 1) : value;
}
