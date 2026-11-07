// Task 358 part R: turns one run id into one wire result and decides every outcome in one place.

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import { buildBackupTimeline, findCwd } from "./reconstruction_backup_timeline.ts";
import { getPathOverrides, type SourceEntry } from "./reconstruction_overrides.ts";
import { buildBackupPathResolver } from "./reconstruction_sidecar_reader.ts";
import { compareChangedFiles, createCompareContext, listChangedFiles } from "./layer1_run_compare.ts";
import { createFailedResult, createOriginalFailedResult, createReplayedResult, createResult } from "./layer1_run_result.ts";
import { findRunSkipReason } from "./layer1_run_skip.ts";
import { computeRunStartFiles, loadReplayRun, type LoadedRun, type ReplayInput } from "./layer1_run_start_files.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { executeSandboxStreaming, type OutputSink } from "./reconstruction_script_sandbox_stream.ts";
import { computeSandboxInputKey } from "./reconstruction_script_sandbox.ts";
import { getMemoizedSandboxOutcome, storeSandboxOutcome, writePendingSandboxMemoToDisk, type SandboxOutcome } from "./reconstruction_script_sandbox_memo.ts";
import { executeWithoutSpawning } from "./reconstruction_script_sandbox_spawn_guard.ts";
import { buildSandboxBox, type SandboxBox } from "./reconstruction_script_sandbox_box.ts";
import { SANDBOX_TIMEOUT_MS } from "./reconstruction_script_sandbox_dir.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { collectErroredToolUseIds } from "./structures/tool-results.ts";

const STEP_LABELS = ["loading the session", "building the start files", "running the script", "comparing the files", "done"];
const NO_START_FILES_REASON = "no known start files";
const BACKUP_FOLDER_LOST_REASON = "backup folder lost";

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

// True when a recorded backup blob has no file-history folder for its session.
export function isBackupFolderLost(loaded: LoadedRun, sources: SourceEntry[] | undefined): boolean {
  const { records } = loaded;
  const resolveBackupPath = buildBackupPathResolver(records, getPathOverrides(), sources);
  if (resolveBackupPath === undefined) {
    return false;
  }
  const timeline = buildBackupTimeline(records, findCwd(records));
  for (const points of timeline.values()) {
    for (const point of points) {
      if (point.backupFileName !== null) {
        const sessionFolder = dirname(resolveBackupPath(point.backupFileName, point.sessionId).toString());
        const isFolderPresent = existsSync(sessionFolder);
        if (!isFolderPresent) {
          return true;
        }
      }
    }
  }
  return false;
}

// A memo hit is final, also a saved crash. A cancelled run saves nothing and returns undefined.
async function executeOrRecallRun(run: ScriptRun, pre: Map<string, string>, box: SandboxBox, onOutput: OutputSink, signal: AbortSignal): Promise<SandboxOutcome | undefined> {
  const inputKey = computeSandboxInputKey(run.code, pre, run.cwd, box);
  const saved = getMemoizedSandboxOutcome(inputKey);
  if (saved !== undefined) {
    return saved;
  }
  const streamed = await executeSandboxStreaming(run.code, pre, run.cwd, onOutput, signal, SANDBOX_TIMEOUT_MS, box);
  if (streamed.isCancelled) {
    return undefined;
  }
  storeSandboxOutcome(inputKey, streamed.post, streamed.output);
  return { post: streamed.post, output: streamed.output };
}

function createFinishedResult(input: ReplayInput, loaded: LoadedRun, pre: Map<string, string>, saved: SandboxOutcome, box: SandboxBox): WireScriptResult {
  if (saved.post === undefined) {
    return createFailedResult(input.toolUseId, saved, box.root);
  }
  const context = createCompareContext(input, loaded);
  const files = compareChangedFiles(context, listChangedFiles(saved.post, pre));
  return createReplayedResult(input.toolUseId, saved, files);
}

async function executeReplayWithStartFiles(input: ReplayInput, loaded: LoadedRun, pre: Map<string, string>, box: SandboxBox, onProgress: ProgressSink, onOutput: OutputSink, signal: AbortSignal): Promise<WireScriptResult | undefined> {
  reportStep(onProgress, 3);
  const saved = await executeOrRecallRun(loaded.run, pre, box, onOutput, signal);
  if (saved === undefined) {
    return undefined;
  }
  reportStep(onProgress, 4);
  const result = createFinishedResult(input, loaded, pre, saved, box);
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
  const isFolderLost = isBackupFolderLost(loaded, input.sources);
  if (isFolderLost) {
    return createResult(input.toolUseId, WireRunOutcome.notReplayed, { reason: BACKUP_FOLDER_LOST_REASON });
  }
  const { pre } = computeRunStartFiles(loaded, input.sources, executeWithoutSpawning, input.repoPath);
  const box = buildSandboxBox(loaded.run, input.repoPath);
  if (pre.size === 0) {
    if (box.project === undefined) {
      return createResult(input.toolUseId, WireRunOutcome.notReplayed, { reason: NO_START_FILES_REASON });
    }
  }
  return executeReplayWithStartFiles(input, loaded, pre, box, onProgress, onOutput, signal);
}
