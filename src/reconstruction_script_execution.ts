// Script-execution replay: event types, run detection, and indirection resolution.

import { BlockType, EventKind, EXECUTOR_TOOL_NAMES, ToolName } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks, type ContentBlock, type ToolUseBlock } from "./structures/content-blocks.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";
import { collectWrittenContentByBasename, applyScriptIndirection } from "./reconstruction_script_indirection.ts";
import { formatRecordSourceToken, getRecordSource, type RecordSource } from "./parse/loadTranscript.ts";

// A script run's proven post-execution content, injected as a synthetic full-content revision; precomputed so replay order can't affect it.
export type ScriptExecutionEvent = {
  kind: EventKind.scriptExecution;
  changeId: Uuid;
  target: Path;
  content: string;
  timestamp: Date;
};


// Task 192: kind comes from the tool block; bash skips the sandbox unless indirection finds a .py body.
export enum ScriptExecutorKind {
  python = "python",
  bash = "bash",
}

// `cwd` is the MCP executor's input.cwd, else the record's; an absent executorKind executes like python (pre-gate behavior).
export type ScriptRun = {
  code: string;
  timestamp: Date;
  cwd?: Path;
  source?: RecordSource;
  toolUseId?: Uuid;
  executorKind?: ScriptExecutorKind;
  // The ctx_execute / ctx_execute_file input's `language`; absent for Bash and for tools without one.
  language?: string;
  invokedScriptFile?: string;
};

// A ctx_execute run in one of these languages is a shell run; every other language keeps the python kind.
const SHELL_LANGUAGES: ReadonlySet<string> = new Set(["shell", "bash"]);

// Follows the originalFile: precedent — a prefixed id getSyntheticChangeIdSourceId unwraps.
export const SCRIPT_RUN_CHANGE_ID_PREFIX = "scriptRun:";

// Deterministic so step-timeline and file-history replays produce joinable ids (item 34); the source segment never contains ':'.
export function computeScriptExecutionChangeId(run: ScriptRun, target: Path): Uuid {
  const sourceSegment = run.toolUseId?.toString() ?? String(run.timestamp.getTime());
  return new Uuid(`${SCRIPT_RUN_CHANGE_ID_PREFIX}${sourceSegment}:${target.toString()}`);
}

// Undefined for non-scriptRun ids, so record uuids, originalFile: seeds and blob refs pass through.
export function getScriptRunSourceIdFromChangeId(changeId: string): string | undefined {
  if (!changeId.startsWith(SCRIPT_RUN_CHANGE_ID_PREFIX)) {
    return undefined;
  }
  const rest = changeId.slice(SCRIPT_RUN_CHANGE_ID_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  return separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
}

// Appended to progress labels so a console line points at the exact JSONL line being processed.
export function formatRunSource(run: ScriptRun): string {
  return formatRecordSourceToken(run.source);
}

// `input.code` (MCP execute) or `input.command` (Bash); undefined for a non-executor tool.
function getScriptCode(block: ToolUseBlock): string | undefined {
  if (!EXECUTOR_TOOL_NAMES.has(block.name)) {
    return undefined;
  }
  const input = block.input as { code?: string; command?: string };
  return input.code ?? input.command;
}

export function isScriptExecutionRun(block: ToolUseBlock): boolean {
  return getScriptCode(block) !== undefined;
}

function listRunsInRecord(record: TranscriptRecord): ScriptRun[] {
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
    const code = getScriptCode(block);
    if (code !== undefined) {
      const blockCwd = (block.input as { cwd?: string }).cwd;
      const cwd = blockCwd !== undefined ? new Path(blockCwd) : recordCwd;
      const language = (block.input as { language?: string }).language;
      // Task 192: the Bash tool and a shell-language ctx run yield bash; every other MCP ctx run stays python.
      const isShell = block.name === ToolName.Bash || (language !== undefined && SHELL_LANGUAGES.has(language));
      const executorKind = isShell ? ScriptExecutorKind.bash : ScriptExecutorKind.python;
      // An absent language must stay absent: a `language: undefined` KEY differs under deep equality.
      runs.push({ code, timestamp, cwd, source, toolUseId: block.id, executorKind, ...(language === undefined ? {} : { language }) });
    }
  }
  return runs;
}

// A run invoking a written script file resolves to that file's body; memoized since repair chain calls this per file.
export function findScriptExecutionRuns(records: TranscriptRecord[]): ScriptRun[] {
  const state = getCorpusState(records);
  if (state.scriptRuns !== undefined) {
    return state.scriptRuns;
  }
  const writtenBodiesByBasename = collectWrittenContentByBasename(records);
  const resolvedRuns: ScriptRun[] = [];
  for (const record of records) {
    for (const run of listRunsInRecord(record)) {
      resolvedRuns.push(applyScriptIndirection(run, writtenBodiesByBasename));
    }
  }
  state.scriptRuns = resolvedRuns;
  return state.scriptRuns;
}
