// Runs one repair-chain stage and degrades to its input on throw (task 119).

import type { Path } from "./structures/domain.ts";
import { FailureScope } from "./structures/vocabulary_views.ts";
import { reportReconstructionFailure } from "./reconstruction_health.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import { DockerStuckError, DockerUnavailableError } from "./reconstruction_script_sandbox_docker.ts";
import { EarlierRunNotSavedError } from "./reconstruction_script_sandbox_spawn_guard.ts";

// These three errors stop the whole build and show on the page (user ruling).
export function rethrowBuildStoppingError(error: unknown): void {
  const isBuildStopping = error instanceof DockerUnavailableError || error instanceof DockerStuckError || error instanceof EarlierRunNotSavedError;
  if (isBuildStopping) {
    throw error;
  }
}

// Announce first so the counter label never freezes at n/n (task 149); the failure is noted.
export function executeStageTolerantly<Args extends unknown[]>(
  stage: string,
  target: Path,
  input: FileEvent[],
  run: (...args: Args) => FileEvent[],
  ...args: Args
): FileEvent[] {
  reportReconstructionProgress(`reconstructing ${target} — ${stage}`);
  try {
    return run(...args);
  }
  catch (error) {
    rethrowBuildStoppingError(error);
    reportReconstructionFailure({ scope: FailureScope.fileStage, stage, target, reason: String(error) });
    return input;
  }
}
