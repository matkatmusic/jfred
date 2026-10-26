// Horizon key for lineage-seed memo: coalesce queries sharing relevant inputs.

import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { getDerivedCaches } from "./reconstruction_corpus.ts";
import {
  findLatestInstantBefore,
  getAllStaticEventInstantsMs,
  getStaticInputsForTarget,
} from "./reconstruction_lineage_inputs.ts";
import { getRunScanForTarget } from "./reconstruction_lineage_run_scan.ts";

// Memo key: target plus latest relevant input before the query instant.
export function computeLineageSeedHorizonKey(
  records: TranscriptRecord[],
  reader: BackupReader,
  target: Path,
  before: Date,
): string {
  const inputs = getStaticInputsForTarget(records, target);
  const derived = getDerivedCaches(records, reader);
  const scan = getRunScanForTarget(records, derived, target, inputs);
  const beforeMs = before.getTime();
  let horizonMs = Math.max(
    findLatestInstantBefore(inputs.ownInstantsMs, beforeMs),
    findLatestInstantBefore(scan.relevantInstantsMs, beforeMs),
  );
  if (scan.firstDiffRelevantMs !== undefined) {
    // ponytail: post-first-touch static events flood the horizon; track proven pairs if this costs real serves.
    const floodMs = findLatestInstantBefore(getAllStaticEventInstantsMs(records), beforeMs);
    if (floodMs > scan.firstDiffRelevantMs) {
      horizonMs = Math.max(horizonMs, floodMs);
    }
  }
  return `${target.toString()}|h${horizonMs}`;
}
