// Text views and shared checks for the reconstruction CLI.

import { USAGE, type CliOptions } from "./reconstruction_cli_args.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BranchedReconstruction } from "./reconstruction_engine.ts";
import { findBranchById, getShortUuid } from "./reconstruction_branch_lookup.ts";
import { renderChosen } from "./reconstruction_render_chosen.ts";
import { buildStepStates } from "./reconstruction_steps.ts";
import { renderRepoSnapshot } from "./reconstruction_step_snapshot.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";

// The selectable branch ids for the `--branch` error message.
export function listAvailableBranchIds(branched: BranchedReconstruction): string {
  const ids: string[] = [];
  if (branched.survivingTip !== undefined) {
    ids.push(`surviving (#${getShortUuid(branched.survivingTip)})`);
  }
  for (const entry of branched.rewound) {
    ids.push(`#${getShortUuid(entry.tip)}`);
  }
  return ids.join(", ");
}

// Throw usage plus the valid range when a 1-based step number is out of bounds.
export function assertStepInRange(stepNumber: number, stepCount: number): void {
  const isBelowRange = stepNumber < 1;
  const isAboveRange = stepNumber > stepCount;
  const isOutOfRange = isBelowRange || isAboveRange;
  if (isOutOfRange) {
    throw new Error(`${USAGE}\nstep must be in 1..${stepCount}`);
  }
}

// Render one branch by `--branch <id>`; throws usage plus available ids when none match.
export function renderOneBranch(
  branched: BranchedReconstruction,
  options: CliOptions,
): string {
  const histories = findBranchById(branched, options.branch!);
  if (histories === undefined) {
    throw new Error(`${USAGE}\navailable branches: ${listAvailableBranchIds(branched)}`);
  }
  return renderChosen(histories, options);
}

// Render one code-change step's full-repo snapshot by `--step <n>` (1-based).
export function renderStep(
  records: TranscriptRecord[],
  reader: BackupReader | undefined,
  stepNumber: number,
): string {
  const steps = buildStepStates(records, reader);
  assertStepInRange(stepNumber, steps.length);
  return renderRepoSnapshot(steps[stepNumber - 1]!);
}
