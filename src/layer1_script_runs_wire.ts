// Task l4-wire-real: the static path scan joins located script runs to pairs for the /api/layer1-script-runs view.

import { WireScriptExecutorKind, type WireScriptRunOf, type WireScriptRunsViewOf } from "../webapp/layer1-wire-script-runs.ts";
import { WireScriptLanguage, formatScriptRunLabel, parseScriptLanguage } from "../webapp/layer1-components/details-drawer/layer1-script-language.ts";
import { FileStampCache, saveFileStampCachesIfChanged } from "./file_stamp_cache.ts";
import { listCurrentFileState } from "./layer1_disk_walk.ts";
import { listSavedRunResults } from "./layer1_run_result_store.ts";
import { loadTranscript, type ProgressSink } from "./parse/loadTranscript.ts";
import { ScriptExecutorKind, findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { findAffectedPathsForRun } from "./reconstruction_script_probe.ts";
import { isScriptCodeWriteCapable } from "./reconstruction_script_prestate.ts";
import { findSessionId } from "./reconstruction_sidecar_reader.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS = "reading script runs";

export type Layer1WireScriptRunsView = WireScriptRunsViewOf<Date, Path, Uuid>;
type WireScriptRunWithoutAxis = Omit<WireScriptRunOf<Date, Path, Uuid>, "axisPx">;

// An absent kind executes like python (src/reconstruction_script_execution.ts ScriptRun).
function convertToWireExecutorKind(kind: ScriptExecutorKind | undefined): WireScriptExecutorKind {
  return kind === ScriptExecutorKind.bash ? WireScriptExecutorKind.bash : WireScriptExecutorKind.python;
}

// A ctx run uses its own language; otherwise the executor decides.
function convertToWireLanguage(run: ScriptRun): WireScriptLanguage {
  if (run.language !== undefined) {
    return parseScriptLanguage(run.language);
  }
  return run.executorKind === ScriptExecutorKind.bash ? WireScriptLanguage.bash : WireScriptLanguage.python;
}

// An absent line or label must stay absent: an `undefined` KEY differs under deep equality.
function createOptionalRunFields(run: ScriptRun, language: WireScriptLanguage): { line?: number; label?: string } {
  const line = run.source === undefined ? {} : { line: run.source.lineNumber };
  const label = run.invokedScriptFile === undefined ? {} : { label: `${formatScriptRunLabel(language)} ${run.invokedScriptFile}` };
  return { ...line, ...label };
}

function buildWireScriptRun(run: ScriptRun, sessionId: Uuid, sessionFile: Path): WireScriptRunWithoutAxis {
  if (run.toolUseId === undefined) {
    throw new Error(`script run at ${run.timestamp.toISOString()} in ${sessionFile.toString()} has no tool_use id`);
  }
  const language = convertToWireLanguage(run);
  const executorKind = convertToWireExecutorKind(run.executorKind);
  const optionalFields = createOptionalRunFields(run, language);
  return { instant: run.timestamp, toolUseId: run.toolUseId, executorKind, language, ...optionalFields, code: run.code, sessionId, sessionFile };
}

function comparePathStrings(left: Path, right: Path): number {
  return left.toString().localeCompare(right.toString());
}

function compareRunInstants(left: WireScriptRunWithoutAxis, right: WireScriptRunWithoutAxis): number {
  return left.instant.getTime() - right.instant.getTime();
}

function computeWriteCapableRuns(sessionFile: Path): WireScriptRunWithoutAxis[] {
  const { records } = loadTranscript(sessionFile.toString(), undefined, true);
  const sessionId = findSessionId(records);
  if (sessionId === undefined) {
    throw new Error(`no session id in ${sessionFile.toString()}`);
  }
  const wireRuns: WireScriptRunWithoutAxis[] = [];
  for (const run of findScriptExecutionRuns(records)) {
    const isWriteCapable = isScriptCodeWriteCapable(run.code);
    if (isWriteCapable) {
      wireRuns.push(buildWireScriptRun(run, sessionId, sessionFile));
    }
  }
  return wireRuns;
}

type SavedWireRun = { instant: string; toolUseId: string; sessionId: string; sessionFile: string } & Pick<WireScriptRunWithoutAxis, "executorKind" | "language" | "code">;

// JSON drops Date/Path/Uuid types: decode rebuilds them. Optional `line`/`label` stay absent when absent.
function decodeWireRuns(json: unknown): WireScriptRunWithoutAxis[] {
  const wireRuns: WireScriptRunWithoutAxis[] = [];
  for (const saved of json as SavedWireRun[]) {
    wireRuns.push({
      ...saved,
      instant: new Date(saved.instant),
      toolUseId: new Uuid(saved.toolUseId),
      sessionId: new Uuid(saved.sessionId),
      sessionFile: new Path(saved.sessionFile),
    });
  }
  return wireRuns;
}

const writeCapableRunsBySessionFile = new FileStampCache<WireScriptRunWithoutAxis[]>("writeCapableScriptRuns", {
  encode: (wireRuns) => wireRuns,
  decode: decodeWireRuns,
});

type RunsByPath = Map<string, Map<string, WireScriptRunWithoutAxis>>;

function listCandidatePaths(projectFolder: Path): Path[] {
  const candidatePaths: Path[] = [];
  for (const file of listCurrentFileState(projectFolder)) {
    candidatePaths.push(file.relativePath);
  }
  return candidatePaths;
}

function addRunToAffectedPaths(runsByPath: RunsByPath, wireRun: WireScriptRunWithoutAxis, candidatePaths: Path[]): void {
  // findAffectedPathsForRun reads only the code.
  for (const path of findAffectedPathsForRun({ code: wireRun.code, timestamp: wireRun.instant }, candidatePaths)) {
    const runsByToolUseId = runsByPath.get(path.toString()) ?? new Map<string, WireScriptRunWithoutAxis>();
    runsByPath.set(path.toString(), runsByToolUseId);
    const toolUseKey = wireRun.toolUseId.toString();
    const isKnownRun = runsByToolUseId.has(toolUseKey);
    if (!isKnownRun) {
      runsByToolUseId.set(toolUseKey, wireRun);
    }
  }
}

function reportSessionProgress(reportProgress: ProgressSink, current: number, total: number): void {
  reportProgress({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS, current, total });
}

function collectRunsByPath(orderedSessionFiles: Path[], candidatePaths: Path[], reportProgress: ProgressSink): RunsByPath {
  const runsByPath: RunsByPath = new Map();
  for (const [index, sessionFile] of orderedSessionFiles.entries()) {
    reportSessionProgress(reportProgress, index + 1, orderedSessionFiles.length);
    const computeSessionRuns = (): WireScriptRunWithoutAxis[] => computeWriteCapableRuns(sessionFile);
    for (const wireRun of writeCapableRunsBySessionFile.readThrough(sessionFile, computeSessionRuns)) {
      addRunToAffectedPaths(runsByPath, wireRun, candidatePaths);
    }
  }
  return runsByPath;
}

function createPairs(runsByPath: RunsByPath): Layer1WireScriptRunsView["pairs"] {
  const pairs: Layer1WireScriptRunsView["pairs"] = [];
  for (const [path, runsByToolUseId] of runsByPath) {
    const scriptRuns = [...runsByToolUseId.values()].sort(compareRunInstants);
    pairs.push({ path: new Path(path), scriptRuns });
  }
  return pairs;
}

function collectSavedResults(orderedSessionFiles: Path[]): Layer1WireScriptRunsView["results"] {
  const results: Layer1WireScriptRunsView["results"] = [];
  for (const sessionFile of orderedSessionFiles) {
    results.push(...listSavedRunResults(sessionFile));
  }
  return results;
}

// Sessions run in lexical order; the first run per pair and tool_use id stands.
export function buildScriptRunsView(
  projectFolder: Path,
  sessionFiles: readonly Path[],
  reportProgress: ProgressSink = () => {},
): Layer1WireScriptRunsView {
  const orderedSessionFiles = [...sessionFiles].sort(comparePathStrings);
  const runsByPath = collectRunsByPath(orderedSessionFiles, listCandidatePaths(projectFolder), reportProgress);
  const pairs = createPairs(runsByPath);
  saveFileStampCachesIfChanged();
  return { pairs, results: collectSavedResults(orderedSessionFiles) };
}
