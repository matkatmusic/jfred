// JSON views of a reconstruction, composing with the CLI selectors.

import { USAGE, type CliOptions } from "./reconstruction_cli_args.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { reconstructBranches } from "./reconstruction_engine.ts";
import { findBranchById } from "./reconstruction_branch_lookup.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import { getRecordVerdict } from "./reconstruction_parse_lines.ts";
import {
  summarizeBranches,
  buildReconstructionDocument,
} from "./reconstruction_json.ts";
import { buildStepSnapshots } from "./reconstruction_json_steps.ts";
import { filterByTarget } from "./reconstruction_render_chosen.ts";
import { computeFilesAtStep } from "./reconstruction_steps.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import {
  isTargetedSurvivingRequest,
  listTargetedSurvivingHistories,
} from "./reconstruction_target.ts";
import { assertStepInRange, listAvailableBranchIds } from "./reconstruction_cli_text.ts";

// Render the reconstruction as JSON: --allRecords, --step, --branch, --list-branches, or the full document.
export function renderJson(
  records: TranscriptRecord[],
  reader: BackupReader | undefined,
  options: CliOptions,
): string {
  if (options.allRecords) {
    // Full body plus per-line classification, line-aligned with records.
    const enriched = [];
    for (const record of records) {
      enriched.push({
        ...record,
        verdict: getRecordVerdict(record),
        isGenuinePrompt: isGenuineUserPrompt(record),
      });
    }
    return JSON.stringify(enriched, null, 2);
  }
  if (options.stepNumber !== undefined) {
    // Step files resolve on demand from the compact histories.
    const { steps, stepFileHistories } = buildStepSnapshots(records, reader);
    assertStepInRange(options.stepNumber, steps.length);
    return JSON.stringify(computeFilesAtStep(stepFileHistories, steps[options.stepNumber - 1]!.when), null, 2);
  }
  // task 192: (surviving, one target) uses the target-scoped engine path.
  const isTargetedSurviving = isTargetedSurvivingRequest(options);
  if (isTargetedSurviving) {
    return JSON.stringify(listTargetedSurvivingHistories(records, reader, options.target!), null, 2);
  }
  const branched = reconstructBranches(records, reader);
  if (options.branch !== undefined) {
    const histories = findBranchById(branched, options.branch);
    if (histories === undefined) {
      throw new Error(`${USAGE}\navailable branches: ${listAvailableBranchIds(branched)}`);
    }
    return JSON.stringify(filterByTarget(histories, options.target), null, 2);
  }
  if (options.listBranches) {
    return JSON.stringify(summarizeBranches(records), null, 2);
  }
  return JSON.stringify(buildReconstructionDocument(records, branched, reader, options.target).document, null, 2);
}
