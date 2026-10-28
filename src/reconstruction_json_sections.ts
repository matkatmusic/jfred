// Tolerant document sections for reconstruction_json.ts. MUST NOT import from reconstruction_json.ts.

import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { FailureScope } from "./structures/vocabulary_views.ts";
import { noteReconstructionFailure } from "./reconstruction_health.ts";
import { buildLineVerdicts } from "./reconstruction_line_verdicts.ts";
import { findGitCommitEvents } from "./reconstruction_git_commit_events.ts";
import { findGitOperations } from "./reconstruction_git_operations.ts";
import { findToolCalls } from "./reconstruction_tool_calls.ts";
import { collectScriptRunFileChanges } from "./reconstruction_script_run_changes.ts";
import type { BranchedReconstruction } from "./reconstruction_engine.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { buildStepSnapshots } from "./reconstruction_json_steps.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";

// Degrades a throwing sub-phase to its fallback so partial results still ship.
export function buildPhaseTolerantly<T>(phase: string, fallback: T, run: () => T): T {
  try {
    return run();
  }
  catch (error) {
    noteReconstructionFailure({ scope: FailureScope.documentPhase, stage: phase, reason: String(error) });
    return fallback;
  }
}

type FileHistories = BranchedReconstruction["surviving"];

function filterHistoriesByTarget(histories: FileHistories, target: Path | undefined): FileHistories {
  const kept: FileHistories = [];
  for (const history of histories) {
    const isUntargeted = target === undefined;
    const isTargetMatch = target !== undefined && history.target.equals(target);
    const isKept = isUntargeted || isTargetMatch;
    if (isKept) {
      kept.push(history);
    }
  }
  return kept;
}

export function buildDocumentSections(
  records: TranscriptRecord[],
  branched: BranchedReconstruction,
  reader: BackupReader | undefined,
  target: Path | undefined,
) {
  const filesTouched = filterHistoriesByTarget(branched.surviving, target);
  // Abandoned-branch histories, unwrapped from branch tags; filtered like filesTouched.
  const rewoundHistories: FileHistories = [];
  for (const branch of branched.rewound) {
    rewoundHistories.push(...branch.histories);
  }
  const rewoundFilesTouched = filterHistoriesByTarget(rewoundHistories, target);

  const buildSteps = () => buildStepSnapshots(records, reader, branched.surviving);
  const buildVerdicts = () => buildLineVerdicts(records);
  const buildCommitMarkers = () => {
    const markers = [];
    for (const event of findGitCommitEvents(records)) {
      markers.push({ timestamp: event.timestamp, sessionId: event.sessionId });
    }
    return markers;
  };
  const buildGitOperations = () => findGitOperations(records);
  const buildToolCalls = () => findToolCalls(records);
  const buildScriptRuns = () => collectScriptRunFileChanges(records, reader);

  reportReconstructionProgress("building step snapshots");
  // task 119: const { steps, stepFileHistories } = buildStepSnapshots(records, reader, branched.surviving);
  const { steps: allSteps, stepFileHistories } = buildPhaseTolerantly(
    "buildStepSnapshots",
    { steps: [], stepFileHistories: [] },
    buildSteps,
  );
  // task 181: --target narrows step timeline to only steps touching the target.
  const steps: typeof allSteps = [];
  for (const step of allSteps) {
    const isUntargeted = target === undefined;
    const isTargetTouched = target !== undefined && step.changedPaths.includes(target.toString());
    const isKept = isUntargeted || isTargetTouched;
    if (isKept) {
      steps.push(step);
    }
  }
  reportReconstructionProgress("building line verdicts");
  // task 119: const lineVerdicts = buildLineVerdicts(records);
  const lineVerdicts = buildPhaseTolerantly("buildLineVerdicts", [], buildVerdicts);
  // task 119: const commitMarkers = findGitCommitEvents(records).map(...);
  const commitMarkers = buildPhaseTolerantly("findGitCommitEvents", [], buildCommitMarkers);
  // task 119: const gitOperations = findGitOperations(records);
  const gitOperations = buildPhaseTolerantly("findGitOperations", [], buildGitOperations);
  // task 119: const toolCalls = findToolCalls(records);
  const toolCalls = buildPhaseTolerantly("findToolCalls", [], buildToolCalls);
  reportReconstructionProgress("summarizing script-run file changes");
  // task 119: const scriptRuns = collectScriptRunFileChanges(records, reader);
  const scriptRuns = buildPhaseTolerantly("collectScriptRunFileChanges", [], buildScriptRuns);
  return {
    filesTouched,
    rewoundFilesTouched,
    steps,
    stepFileHistories,
    lineVerdicts,
    commitMarkers,
    gitOperations,
    toolCalls,
    scriptRuns,
  };
}
