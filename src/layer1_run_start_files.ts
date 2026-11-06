// Task 358 part R: loads one run and builds its start files without ever spawning an earlier run.

import { executeWithImpureExecution } from "./reconstruction_exec_gate.ts";
import { loadTranscript } from "./parse/loadTranscript.ts";
import { isReplayedLanguage } from "./layer1_run_skip.ts";
import { getLineageContentBefore } from "./reconstruction_lineage_content.ts";
import { getPathOverrides, type SourceEntry } from "./reconstruction_overrides.ts";
import { findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { getPreExecutionState } from "./reconstruction_script_prestate.ts";
import { executeInRealBox } from "./reconstruction_script_sandbox_box.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { collectErroredToolUseIds } from "./structures/tool-results.ts";

export interface RunInput {
  sessionFile: Path;
  toolUseId: Uuid;
  dir: Path;
  repoPath: Path;
  sources: SourceEntry[] | undefined;
}
export interface ReplayInput extends RunInput {
  sessionFiles: Path[];
}
export interface LoadedRun {
  run: ScriptRun;
  records: TranscriptRecord[];
}
// executeWithoutSpawning (throw mode) or collectEarlierRuns (collect mode) fits this shape.
export type LineageRunner<Result> = (neverRunScripts: Set<string>, compute: () => void) => Result;
export interface RunStartFiles<Result> extends LoadedRun {
  pre: Map<string, string>;
  lineageResult: Result;
}

export function loadReplayRun(input: RunInput): LoadedRun {
  const { records } = loadTranscript(input.sessionFile.toString(), undefined, true);
  for (const run of findScriptExecutionRuns(records)) {
    const isTarget = run.toolUseId?.equals(input.toolUseId) === true;
    if (isTarget) {
      return { run, records };
    }
  }
  throw new Error(`no script run ${input.toolUseId} in ${input.sessionFile}`);
}

// Code texts the guard must never spawn: runs that errored and runs in a language that is not python.
function listNeverRunScripts(records: TranscriptRecord[]): Set<string> {
  const erroredIds = collectErroredToolUseIds(records);
  const scripts = new Set<string>();
  for (const run of findScriptExecutionRuns(records)) {
    const isErrored = erroredIds.has(String(run.toolUseId));
    const isOtherLanguage = !isReplayedLanguage(run.language);
    const isNeverRun = isErrored || isOtherLanguage;
    if (isNeverRun) {
      scripts.add(run.code);
    }
  }
  return scripts;
}

// A new reader per request: a shared one keeps stale per-run results in the derived caches.
function createRunReader(records: TranscriptRecord[], sources: SourceEntry[] | undefined): BackupReader {
  const reader = buildSidecarReader(records, getPathOverrides(), sources);
  if (reader === undefined) {
    throw new Error("the session has no session id, so its file history cannot be read");
  }
  return reader;
}

function computePreState(run: ScriptRun, records: TranscriptRecord[], reader: BackupReader): Map<string, string> {
  const seedContent = getLineageContentBefore(records, reader, getPathOverrides());
  return getPreExecutionState(run, records, reader, seedContent);
}

export function computeRunStartFiles<Result>(loaded: LoadedRun, sources: SourceEntry[] | undefined, runLineage: LineageRunner<Result>, repo: Path): RunStartFiles<Result> {
  const { run, records } = loaded;
  const reader = createRunReader(records, sources);
  const holder = { pre: new Map<string, string>() };
  const computeHolderPre = () => {
    holder.pre = computePreState(run, records, reader);
  };
  const executeLineage = () => runLineage(listNeverRunScripts(records), computeHolderPre);
  const executeLineageInBox = () => executeInRealBox(repo, executeLineage);
  const lineageResult = executeWithImpureExecution(executeLineageInBox);
  return { ...loaded, pre: holder.pre, lineageResult };
}
