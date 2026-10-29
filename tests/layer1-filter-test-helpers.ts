import assert from "node:assert/strict";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

// Full ISO-8601 UTC, because the re-layout round-trips these through Date.toISOString().
export const EARLY = "2026-07-01T08:00:00.000Z";
export const T0 = "2026-07-01T10:00:00.000Z";
export const T1 = "2026-07-01T11:00:00.000Z";
export const T2 = "2026-07-01T12:00:00.000Z";
export const T3 = "2026-07-01T13:00:00.000Z";
export const T4 = "2026-07-01T14:00:00.000Z";
export const T5 = "2026-07-01T15:00:00.000Z";
export const T6 = "2026-07-01T16:00:00.000Z";
export const T7 = "2026-07-01T17:00:00.000Z";

// `src/drop/` owns BOTH the earliest and latest instants, so reused server offsets fail on both.
export const KEEP_TARGETS = ["src/keep/a.ts", "src/keep/b.ts", "src/keep/deep/d.ts", "src/keep/extra.ts"];

export const FULL_VIEW: WireLayer1View = {
  pairs: [
    { path: "src/keep/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 22 }, { hash: "ab", instant: T2, axisPx: 66 }], onDisk: { instant: T5, axisPx: 154 } },
    { path: "src/keep/b.ts", commits: [{ hash: "ba", instant: T3, axisPx: 88 }], onDisk: { instant: T3, axisPx: 110 } },
    { path: "src/keep/deep/d.ts", commits: [{ hash: "da", instant: T1, axisPx: 44 }], onDisk: { instant: T6, axisPx: 176 } },
    { path: "src/drop/c.ts", commits: [{ hash: "ca", instant: EARLY, axisPx: 0 }], onDisk: { instant: T4, axisPx: 132 } },
  ],
  gitOrphans: [{ path: "src/drop/gone.ts", instant: T7, axisPx: 198 }],
  diskOrphans: [{ path: "src/keep/extra.ts", instant: T2, axisPx: 66 }],
  // The filter RE-MEASURES eventCount rather than carrying it over, so these expectations drop with the records they counted.
  ruler: buildRuler(),
};

function buildRuler(): WireLayer1View["ruler"] {
  const instants = [EARLY, T0, T1, T2, T3, T4, T5, T6, T7];
  const axisPxs = [0, 22, 44, 66, 88, 132, 154, 176, 198];
  const eventCounts = [1, 1, 1, 2, 2, 1, 1, 1, 1];
  const ruler: WireLayer1View["ruler"] = [];
  for (let index = 0; index < instants.length; index++) {
    ruler.push({ instant: instants[index]!, axisPx: axisPxs[index]!, eventCount: eventCounts[index]! });
  }
  return ruler;
}

export function findPair(view: WireLayer1View, path: string) {
  for (const pair of view.pairs) {
    if (pair.path === path)
      return pair;
  }
  assert.fail(`no pair for ${path}`);
}
