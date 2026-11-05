// Task 358 part R: turns one run id into one wire result and decides every outcome in one place.

import { WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import { compareChangedFiles, createCompareContext, listChangedFiles } from "./layer1_run_compare.ts";
import { createFailedResult, createOriginalFailedResult, createReplayedResult, createResult } from "./layer1_run_result.ts";
import { findRunSkipReason } from "./layer1_run_skip.ts";
import { computeRunStartFiles, loadReplayRun, type LoadedRun, type ReplayInput } from "./layer1_run_start_files.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { executeSandboxStreaming, type OutputSink } from "./reconstruction_script_sandbox_stream.ts";
import { computeSandboxInputKey } from "./reconstruction_script_sandbox.ts";
import { getMemoizedSandboxOutcome, storeSandboxOutcome, writePendingSandboxMemoToDisk, type SandboxOutcome } from "./reconstruction_script_sandbox_memo.ts";
import { executeWithoutSpawning } from "./reconstruction_script_sandbox_spawn_guard.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { collectErroredToolUseIds } from "./structures/tool-results.ts";

const STEP_LABELS = ["loading the session", "building the start files", "running the script", "comparing the files", "done"];
const NO_START_FILES_REASON = "no known start files";

function reportStep(onProgress: ProgressSink, step: number): void {
  onProgress({ kind: DocumentResponseKind.progress, label: STEP_LABELS[step - 1]!, current: step, total: STEP_LABELS.length });
}

function createSkippedResult(input: ReplayInput, loaded: LoadedRun): WireScriptResult | undefined {
  const isErrored = collectErroredToolUseIds(loaded.records).has(input.toolUseId.toString());
  if (isErrored) {
    return createOriginalFailedResult(input.toolUseId, loaded.run, input.dir);
  }
  const reason = findRunSkipReason(loaded.run);
  return reason === undefined ? undefined : createResult(input.toolUseId, WireRunOutcome.notReplayed, { reason });
}

// A memo hit is final, also a saved crash. A cancelled run saves nothing and returns undefined.
async function executeOrRecallRun(run: ScriptRun, pre: Map<string, string>, onOutput: OutputSink, signal: AbortSignal): Promise<SandboxOutcome | undefined> {
  const inputKey = computeSandboxInputKey(run.code, pre, run.cwd);
  const saved = getMemoizedSandboxOutcome(inputKey);
  if (saved !== undefined) {
    return saved;
  }
  const streamed = await executeSandboxStreaming(run.code, pre, run.cwd, onOutput, signal);
  if (streamed.isCancelled) {
    return undefined;
  }
  storeSandboxOutcome(inputKey, streamed.post, streamed.output);
  return { post: streamed.post, output: streamed.output };
}

function createFinishedResult(input: ReplayInput, loaded: LoadedRun, pre: Map<string, string>, saved: SandboxOutcome): WireScriptResult {
  if (saved.post === undefined) {
    return createFailedResult(input.toolUseId, loaded.run, saved);
  }
  const context = createCompareContext(input, loaded);
  const files = compareChangedFiles(context, listChangedFiles(saved.post, pre));
  return createReplayedResult(input.toolUseId, saved, files);
}

async function executeReplayWithStartFiles(input: ReplayInput, loaded: LoadedRun, pre: Map<string, string>, onProgress: ProgressSink, onOutput: OutputSink, signal: AbortSignal): Promise<WireScriptResult | undefined> {
  reportStep(onProgress, 3);
  const saved = await executeOrRecallRun(loaded.run, pre, onOutput, signal);
  if (saved === undefined) {
    return undefined;
  }
  reportStep(onProgress, 4);
  const result = createFinishedResult(input, loaded, pre, saved);
  writePendingSandboxMemoToDisk();
  reportStep(onProgress, 5);
  return result;
}

// Undefined means the request was cancelled and nobody is listening.
export async function executeRunReplay(input: ReplayInput, onProgress: ProgressSink, onOutput: OutputSink, signal: AbortSignal): Promise<WireScriptResult | undefined> {
  reportStep(onProgress, 1);
  const loaded = loadReplayRun(input);
  const skipped = createSkippedResult(input, loaded);
  if (skipped !== undefined) {
    return skipped;
  }
  reportStep(onProgress, 2);
  const { pre } = computeRunStartFiles(loaded, input.sources, executeWithoutSpawning);
  if (pre.size === 0) {
    return createResult(input.toolUseId, WireRunOutcome.notReplayed, { reason: NO_START_FILES_REASON });
  }
  return executeReplayWithStartFiles(input, loaded, pre, onProgress, onOutput, signal);
}
