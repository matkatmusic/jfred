// Branch summary view for the CLI `--list-branches` flag: one line per branch.

import type { BranchedReconstruction } from "./reconstruction_engine.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import { getShortUuid } from "./reconstruction_branch_lookup.ts";
import { getBaseName } from "./reconstruction_labels.ts";

// The basenames of the files a branch touched, comma-joined (its "files changed" column).
function listBranchFiles(histories: FileHistory[]): string {
  const names: string[] = [];
  for (const history of histories) {
    names.push(getBaseName(history.target));
  }
  return names.join(", ");
}

// One summary line per branch: kind, tip short id, rewind point if rewound, then touched files.
export function renderBranchSummary(branched: BranchedReconstruction): string {
  const lines: string[] = [];
  if (branched.survivingTip !== undefined) {
    const files = listBranchFiles(branched.surviving);
    lines.push(`surviving  tip #${getShortUuid(branched.survivingTip)}    ${files}`);
  }
  for (const entry of branched.rewound) {
    const files = listBranchFiles(entry.histories);
    lines.push(
      `rewound    tip #${getShortUuid(entry.tip)}  rewind @ #${getShortUuid(entry.rewindPoint)}    ${files}`,
    );
  }
  return lines.join("\n");
}
