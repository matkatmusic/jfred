// Task l4-wire-real: the static path scan joins located script runs to pairs for the /api/layer1-script-runs view.

import { WireScriptExecutorKind, type WireScriptRunOf, type WireScriptRunsViewOf } from "../webapp/layer1-wire-script-runs.ts";
import { WireScriptLanguage, describeScriptLanguage, parseScriptLanguage } from "../webapp/layer1-script-language.ts";
import { listCurrentFileState } from "./layer1_disk_walk.ts";
import { loadTranscript, type ProgressSink } from "./parse/loadTranscript.ts";
import { ScriptExecutorKind, findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { affectedPathsForRun } from "./reconstruction_script_probe.ts";
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

function buildWireScriptRun(run: ScriptRun, sessionId: Uuid, sessionFile: Path): WireScriptRunWithoutAxis {
  if (run.toolUseId === undefined) {
    throw new Error(`script run at ${run.timestamp.toISOString()} in ${sessionFile.toString()} has no tool_use id`);
  }
  const language = convertToWireLanguage(run);
  return {
    instant: run.timestamp,
    toolUseId: run.toolUseId,
    executorKind: convertToWireExecutorKind(run.executorKind),
    language,
    // An absent line must stay absent: a `line: undefined` KEY differs under deep equality.
    ...(run.source === undefined ? {} : { line: run.source.lineNumber }),
    code: run.code,
    // An absent label must stay absent: a `label: undefined` KEY differs under deep equality.
    ...(run.invokedScriptFile === undefined ? {} : { label: `${describeScriptLanguage(language)} ${run.invokedScriptFile}` }),
    sessionId,
    sessionFile,
  };
}

function comparePathStrings(left: Path, right: Path): number {
  return left.toString().localeCompare(right.toString());
}

function compareRunInstants(left: WireScriptRunWithoutAxis, right: WireScriptRunWithoutAxis): number {
  return left.instant.getTime() - right.instant.getTime();
}

// Sessions run in lexical order; the first run per pair and tool_use id stands.
export function buildScriptRunsView(
  projectFolder: Path,
  sessionFiles: readonly Path[],
  reportProgress: ProgressSink = () => {},
): Layer1WireScriptRunsView {
  const candidatePaths: Path[] = [];
  for (const file of listCurrentFileState(projectFolder)) {
    candidatePaths.push(file.relativePath);
  }
  const runsByPath = new Map<string, Map<string, WireScriptRunWithoutAxis>>();
  const orderedSessionFiles = [...sessionFiles].sort(comparePathStrings);
  for (const [index, sessionFile] of orderedSessionFiles.entries()) {
    reportProgress({
      kind: DocumentResponseKind.progress,
      label: LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS,
      current: index + 1,
      total: orderedSessionFiles.length,
    });
    const { records } = loadTranscript(sessionFile.toString(), undefined, true);
    const sessionId = findSessionId(records);
    if (sessionId === undefined) {
      throw new Error(`no session id in ${sessionFile.toString()}`);
    }
    for (const run of findScriptExecutionRuns(records)) {
      const isWriteCapable = isScriptCodeWriteCapable(run.code);
      if (!isWriteCapable) {
        continue;
      }
      const wireRun = buildWireScriptRun(run, sessionId, sessionFile);
      for (const path of affectedPathsForRun(run, candidatePaths)) {
        const runsByToolUseId = runsByPath.get(path.toString()) ?? new Map<string, WireScriptRunWithoutAxis>();
        runsByPath.set(path.toString(), runsByToolUseId);
        const toolUseKey = wireRun.toolUseId.toString();
        const isKnownRun = runsByToolUseId.has(toolUseKey);
        if (!isKnownRun) {
          runsByToolUseId.set(toolUseKey, wireRun);
        }
      }
    }
  }
  const pairs: Layer1WireScriptRunsView["pairs"] = [];
  for (const [path, runsByToolUseId] of runsByPath) {
    const scriptRuns = [...runsByToolUseId.values()].sort(compareRunInstants);
    pairs.push({ path: new Path(path), scriptRuns });
  }
  return { pairs };
}
