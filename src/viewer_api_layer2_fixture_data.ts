// Task 354: Layer 2 fixture data: the file-history snapshots, split out of viewer_api_layer1_fixture_data.ts.  Loading this module also runs the shared bulk generator, which appends to the layer 1 arrays too.

import { Path } from "./structures/domain.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import { buildBulkFixture } from "./viewer_api_fixture_bulk.ts";
import { COMMITS, DISK, SESSIONS, ms, sessionFileFor, sessionIdFor } from "./viewer_api_layer1_fixture_data.ts";

export interface FixtureSnapshot { path: string; version: string; at: string; session: string; line: number; }

// @vN is numbered PER SESSION: src/util.ts carries @v2 from b21d84c5 AND a different one from d4a06b8f.
export const SNAPSHOTS: FixtureSnapshot[] = [
  { path: "src/index.ts", version: "@v1", at: "2026-06-01T08:50:00Z", session: "0f3c9a7e.jsonl", line: 40 },
  { path: "src/index.ts", version: "@v2", at: "2026-06-01T09:05:00Z", session: "0f3c9a7e.jsonl", line: 95 },
  { path: "src/util.ts", version: "@v1", at: "2026-06-01T14:20:00Z", session: "b21d84c5.jsonl", line: 60 },
  { path: "src/util.ts", version: "@v2", at: "2026-06-03T10:30:00Z", session: "b21d84c5.jsonl", line: 300 },
  { path: "src/util.ts", version: "@v2", at: "2026-07-24T08:00:00Z", session: "d4a06b8f.jsonl", line: 120 },
  { path: "src/index.ts", version: "@v3", at: "2026-07-24T08:15:00Z", session: "d4a06b8f.jsonl", line: 200 },
  { path: "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts",
    version: "@v1", at: "2026-07-23T19:55:00Z", session: "d4a06b8f.jsonl", line: 30 },
];

buildBulkFixture({ commits: COMMITS, disk: DISK, sessions: SESSIONS, snapshots: SNAPSHOTS });

// The snapshot placements for one path, ascending — the SnapshotPlacement shape the wire builder wants.
export function fixtureSnapshotPlacements(path: string): SnapshotPlacement[] {
  return SNAPSHOTS.filter((s) => s.path === path)
    .map((s) => ({
      path: new Path(s.path),
      version: Number(s.version.replace("@v", "")),
      instant: new Date(ms(s.at)),
      sessionId: sessionIdFor(s.session),
      sessionFile: sessionFileFor(s.session),
      line: s.line,
      backupFileName: new Path(`${s.session}-${s.version}`),
    }))
    .sort((left, right) => left.instant.getTime() - right.instant.getTime());
}
