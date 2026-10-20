// Task 318: the Layer 2 view payload shape and the pure helpers that read it.

interface WireSnapshot { version: number; sessionId: string; sessionFile: string; line?: number }
interface WirePair { path: string; snapshots?: WireSnapshot[] }
export interface ViewPayload { pairs: WirePair[]; diskOrphans: { snapshots?: WireSnapshot[] }[] }

export function countExpectedSnapshots(payload: ViewPayload): number {
  let total = 0;
  for (const pair of payload.pairs) {
    total += pair.snapshots?.length ?? 0;
  }
  for (const orphan of payload.diskOrphans) {
    total += orphan.snapshots?.length ?? 0;
  }
  return total;
}

// The owning-session basenames the payload says a snapshot came from: what a flash must match.
export function collectOwnerBasenames(payload: ViewPayload): Set<string> {
  const basenames = new Set<string>();
  for (const pair of payload.pairs) {
    for (const snapshot of pair.snapshots ?? []) {
      basenames.add(snapshot.sessionFile.split("/").pop() ?? snapshot.sessionFile);
    }
  }
  return basenames;
}
