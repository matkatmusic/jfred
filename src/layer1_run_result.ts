// Task 358 part R: builds the wire result for each way a replay request can end.

import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome, WireRunStreamKind, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import { listCurrentFileState } from "./layer1_disk_walk.ts";
import { findRunConfidence, type RunFile } from "./layer1_run_compare.ts";
import { formatReplayFailure } from "./layer1_run_skip.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
// import { chooseSandboxMount } from "./reconstruction_script_sandbox_docker.ts";
import type { SandboxOutcome, SandboxOutput } from "./reconstruction_script_sandbox_memo.ts";
import { findAffectedPathsForRun } from "./reconstruction_script_probe.ts";
import type { Path, Uuid } from "./structures/domain.ts";

export const OUTPUT_NOT_SAVED_REASON = "The script failed. Its output was not saved.";

export function createResult(toolUseId: Uuid, outcome: WireRunOutcome, extra: Partial<WireScriptResult> = {}): WireScriptResult {
  return { kind: WireRunStreamKind.result, toolUseId: toolUseId.toString(), outcome, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true, ...extra };
}

// An entry saved before this task has no output.
function formatOutputFields(output: SandboxOutput | undefined): Partial<WireScriptResult> {
  if (output === undefined) {
    return { isOutputSaved: false };
  }
  const exitCode = output.exitCode === undefined ? {} : { exitCode: output.exitCode };
  return { stdout: output.stdout, stderr: output.stderr, timedOut: output.timedOut, ...exitCode };
}

// The run-level confidence is set directly: findWorstConfidence rejects original-failed.
export function createOriginalFailedResult(toolUseId: Uuid, run: ScriptRun, dir: Path): WireScriptResult {
  const candidatePaths: Path[] = [];
  for (const file of listCurrentFileState(dir)) {
    candidatePaths.push(file.relativePath);
  }
  const files: RunFile[] = [];
  for (const path of findAffectedPathsForRun(run, candidatePaths)) {
    files.push({ path: path.toString(), confidence: WireConfidence.originalFailed });
  }
  return createResult(toolUseId, WireRunOutcome.originalFailed, { confidence: WireConfidence.originalFailed, files });
}

export function createFailedResult(toolUseId: Uuid, saved: SandboxOutcome, mount: Path): WireScriptResult {
  // const mount = chooseSandboxMount(run.cwd);
  const reason = saved.output === undefined ? OUTPUT_NOT_SAVED_REASON : formatReplayFailure(saved.output, mount);
  return createResult(toolUseId, WireRunOutcome.replayFailed, { reason, ...formatOutputFields(saved.output) });
}

export function createReplayedResult(toolUseId: Uuid, saved: SandboxOutcome, files: RunFile[]): WireScriptResult {
  const confidence = findRunConfidence(files);
  const runConfidence = confidence === undefined ? {} : { confidence };
  return createResult(toolUseId, WireRunOutcome.replayed, { files, ...formatOutputFields(saved.output), ...runConfidence });
}
