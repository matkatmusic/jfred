// Task 358 part R: gives each file a replayed run changed a verdict against the nearest proof.

import { WireConfidence, WireEditKind } from "../webapp/layer1-wire-edits.ts";
import { WireFileChange, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import { listBeaconCandidates } from "./layer1_beacon_candidates.ts";
import { readSessionEditEvents, type LayerEditEvent } from "./layer1_edit_events.ts";
import { isMatchingWorkingTree } from "./layer1_run_tree_confirm.ts";
import type { LoadedRun, ReplayInput } from "./layer1_run_start_files.ts";
import { computeFileVerdict, findNearestBeaconAfter, findWorstConfidence, isChangeBetween, type ChangeEvent } from "./layer1_run_verdict.ts";
import { convertToProjectRelativePath } from "./layer1_snapshot_wire.ts";
import { loadTranscript } from "./parse/loadTranscript.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { findAffectedPathsForRun } from "./reconstruction_script_probe.ts";
import { isScriptCodeWriteCapable } from "./reconstruction_script_prestate.ts";
import { isJunkStateKey } from "./reconstruction_script_sandbox.ts";
import { Path } from "./structures/domain.ts";
import { normalizeAgainstCwd } from "./structures/path-resolve.ts";

export type RunFile = WireScriptResult["files"][number];
export interface CompareContext {
  input: ReplayInput;
  run: ScriptRun;
  editEvents: LayerEditEvent[];
  otherRuns: ScriptRun[];
}

function listSessionWriteRuns(sessionFile: Path, input: ReplayInput, loaded: LoadedRun): ScriptRun[] {
  const isLoadedSession = sessionFile.equals(input.sessionFile);
  const records = isLoadedSession ? loaded.records : loadTranscript(sessionFile.toString(), undefined, true).records;
  const runs: ScriptRun[] = [];
  for (const run of findScriptExecutionRuns(records)) {
    const isOtherRun = run.toolUseId?.equals(input.toolUseId) !== true;
    const isWriteCapable = isScriptCodeWriteCapable(run.code);
    const isOtherWriter = isOtherRun && isWriteCapable;
    if (isOtherWriter) {
      runs.push(run);
    }
  }
  return runs;
}

export function createCompareContext(input: ReplayInput, loaded: LoadedRun): CompareContext {
  const editEvents: LayerEditEvent[] = [];
  const otherRuns: ScriptRun[] = [];
  for (const sessionFile of input.sessionFiles) {
    editEvents.push(...readSessionEditEvents(sessionFile));
    otherRuns.push(...listSessionWriteRuns(sessionFile, input, loaded));
  }
  return { input, run: loaded.run, editEvents, otherRuns };
}

// An other script run that names the path counts as a write at its instant.
function listOtherRunWrites(otherRuns: ScriptRun[], target: Path): ChangeEvent[] {
  const writes: ChangeEvent[] = [];
  for (const run of otherRuns) {
    const namesTarget = findAffectedPathsForRun(run, [target]).length > 0;
    if (namesTarget) {
      writes.push({ kind: WireEditKind.write, target, instant: run.timestamp });
    }
  }
  return writes;
}

export function listChangedFiles(post: Map<string, string>, pre: Map<string, string>): [string, string][] {
  const changed: [string, string][] = [];
  for (const [key, content] of post) {
    const isReported = pre.get(key) !== content && !isJunkStateKey(key);
    if (isReported) {
      changed.push([key, content]);
    }
  }
  return changed;
}

function computeChangedFileConfidence(context: CompareContext, target: Path, relativePath: string, content: string): WireConfidence {
  const { input, run } = context;
  const candidates = listBeaconCandidates(target, input.sessionFiles, input.repoPath, input.sources, getPathOverrides());
  const beacon = findNearestBeaconAfter(candidates, run.timestamp);
  const changeEvents = [...context.editEvents, ...listOtherRunWrites(context.otherRuns, target)];
  const isChanged = beacon !== undefined && isChangeBetween(target, run.timestamp, beacon.instant, changeEvents);
  const verdict = computeFileVerdict(content, beacon, isChanged);
  if (verdict !== undefined) {
    return verdict;
  }
  const isOnDisk = isMatchingWorkingTree(input.dir, new Path(relativePath), content);
  return isOnDisk ? WireConfidence.verified : WireConfidence.injectedUnverified;
}

// Deleted and not-text files get no rating; junk keys and files outside the project are left out.
function listUnratedFiles(context: CompareContext, keys: string[], change: WireFileChange): RunFile[] {
  const files: RunFile[] = [];
  for (const key of keys) {
    const absolute = normalizeAgainstCwd(context.run.cwd, new Path(key));
    const relativePath = convertToProjectRelativePath(context.input.dir, absolute);
    const isReported = relativePath !== undefined && !isJunkStateKey(key);
    if (isReported) {
      files.push({ path: relativePath, change });
    }
  }
  return files;
}

// A file outside the project folder has no project-relative path, so it is not on the wire.
export function compareChangedFiles(context: CompareContext, changed: [string, string][], deletedKeys: string[], notTextKeys: string[]): RunFile[] {
  const files: RunFile[] = [];
  for (const [key, content] of changed) {
    const absolute = normalizeAgainstCwd(context.run.cwd, new Path(key));
    const relativePath = convertToProjectRelativePath(context.input.dir, absolute);
    if (relativePath !== undefined) {
      files.push({ path: relativePath, change: WireFileChange.changed, confidence: computeChangedFileConfidence(context, new Path(absolute), relativePath, content) });
    }
  }
  files.push(...listUnratedFiles(context, deletedKeys, WireFileChange.deleted), ...listUnratedFiles(context, notTextKeys, WireFileChange.changedNotText));
  return files;
}

export function findRunConfidence(files: RunFile[]): WireConfidence | undefined {
  const confidences: WireConfidence[] = [];
  for (const file of files) {
    if (file.confidence !== undefined) {
      confidences.push(file.confidence);
    }
  }
  return findWorstConfidence(confidences);
}
