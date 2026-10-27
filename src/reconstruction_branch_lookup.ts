// Branch lookups: short ids, branch history by id, and the default deleted target.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { selectLiveBranch } from "./reconstruction_branch.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import type { BranchedReconstruction } from "./reconstruction_engine.ts";

// Canonical short-id: first 8 chars of a branch tip's uuid string.
export function shortUuid(uuid: Uuid): string {
  return uuid.toString().slice(0, 8);
}

// Looks up branch histories by id: "surviving" or a rewound tip's short uuid.
export function findBranchById(
  branched: BranchedReconstruction,
  id: string,
): FileHistory[] | undefined {
  if (id === "surviving") {
    return branched.surviving;
  }
  const match = branched.rewound.find((entry) => shortUuid(entry.tip) === id);
  if (match === undefined) {
    return undefined;
  }
  return match.histories;
}

// Return the first file deleted on the surviving branch, if any, as a default target.
export function findDeletedTarget(
  records: TranscriptRecord[],
): Path | undefined {
  const deletion = extractFileEvents(selectLiveBranch(records)).find(
    (event) => event.kind === EventKind.delete,
  );
  return deletion?.kind === EventKind.delete ? deletion.target : undefined;
}
