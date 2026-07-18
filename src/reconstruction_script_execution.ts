// Script-execution replay: event types, run detection, and indirection resolution. The pre-execution
// analysis/state seeding lives in reconstruction_script_prestate.ts, the sandbox execution + memo in
// reconstruction_script_sandbox.ts, and the validation/injection stage in reconstruction_script_stage.ts.

import { BlockType, EventKind, EXECUTOR_TOOL_NAMES, ToolName } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks, type ContentBlock, type ToolUseBlock } from "./structures/content-blocks.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";
import { indexWrittenContentByBasename, resolveScriptIndirection } from "./reconstruction_script_indirection.ts";
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

// Every script-execution run in the transcript, in record order, each with its source and timestamp.
// A run that invokes a written script file is resolved to that file's body (resolveScriptIndirection).
// Memoized per records identity in the corpus (pure group): the result depends on the records alone,
// and the per-file repair chain calls this once per reconstructed file.
export function findScriptExecutionRuns(records: TranscriptRecord[]): ScriptRun[] {
    const state = getCorpusState(records);
    if (state.scriptRuns !== undefined) {
        return state.scriptRuns;
    }
    const writtenBodiesByBasename = indexWrittenContentByBasename(records);
    state.scriptRuns = records.flatMap(runsInRecord).map((run) => resolveScriptIndirection(run, writtenBodiesByBasename));
    return state.scriptRuns;
}
