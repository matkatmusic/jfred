// Tolerant document sections for reconstruction_json.ts. MUST NOT import from reconstruction_json.ts.

import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { FailureScope } from "./structures/vocabulary_views.ts";
import { noteReconstructionFailure } from "./reconstruction_health.ts";
import { buildLineVerdicts } from "./reconstruction_line_verdicts.ts";
import { findGitCommitEvents } from "./reconstruction_git_commit_events.ts";
import { findGitOperations } from "./reconstruction_git_operations.ts";
import { findToolCalls } from "./reconstruction_tool_calls.ts";
import { summarizeScriptRunFileChanges } from "./reconstruction_script_run_changes.ts";
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

export function buildDocumentSections(
  records: TranscriptRecord[],
  branched: BranchedReconstruction,
  reader: BackupReader | undefined,
  target: Path | undefined,
) {
  const filesTouched =
    target === undefined
      ? branched.surviving
      : branched.surviving.filter((history) => history.target.equals(target));
    // Abandoned-branch histories, unwrapped from branch tags; filtered like filesTouched.
  const rewoundHistories = branched.rewound.flatMap((branch) => branch.histories);
  const rewoundFilesTouched =
    target === undefined
      ? rewoundHistories
      : rewoundHistories.filter((history) => history.target.equals(target));
  reportReconstructionProgress("building step snapshots");
  // task 119: const { steps, stepFileHistories } = buildStepSnapshots(records, reader, branched.surviving);
  const { steps: allSteps, stepFileHistories } = buildPhaseTolerantly(
    "buildStepSnapshots",
    { steps: [], stepFileHistories: [] },
    () => buildStepSnapshots(records, reader, branched.surviving),
  );
    // task 181: --target narrows step timeline to only steps touching the target.
  const steps =
    target === undefined
      ? allSteps
      : allSteps.filter((step) => step.changedPaths.includes(target.toString()));
  reportReconstructionProgress("building line verdicts");
  // task 119: const lineVerdicts = buildLineVerdicts(records);
  const lineVerdicts = buildPhaseTolerantly("buildLineVerdicts", [], () => buildLineVerdicts(records));
  // task 119: const commitMarkers = findGitCommitEvents(records).map(...);
  const commitMarkers = buildPhaseTolerantly("findGitCommitEvents", [], () => findGitCommitEvents(records).map((event) => ({
    timestamp: event.timestamp,
    sessionId: event.sessionId,
  })));
    // task 119: const gitOperations = findGitOperations(records);
  const gitOperations = buildPhaseTolerantly("findGitOperations", [], () => findGitOperations(records));
  // task 119: const toolCalls = findToolCalls(records);
  const toolCalls = buildPhaseTolerantly("findToolCalls", [], () => findToolCalls(records));
  reportReconstructionProgress("summarizing script-run file changes");
  // task 119: const scriptRuns = summarizeScriptRunFileChanges(records, reader);
  const scriptRuns = buildPhaseTolerantly("summarizeScriptRunFileChanges", [], () => summarizeScriptRunFileChanges(records, reader));
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
