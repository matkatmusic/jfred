// Task 383 canned fixture: a jfred base and two commits on real ruler ticks.

import type { Layer1WireView } from "./viewer_api_layer1.ts";

const WALL_CLOCK = "2026-11-03T12:00:00Z";
const BASE_HASH = "a1b2c3d4";
export const JFRED_BASE_AT = new Date("2026-06-01T09:00:00Z");
const FIRST_MARK_AT = new Date("2026-06-01T09:05:00Z");
const SECOND_MARK_AT = new Date("2026-06-03T10:30:00Z");
// The canned mark that changes no file, so the unchanged reply is shown.
export const FIXTURE_UNCHANGED_MARK_AT = new Date("2026-06-03T11:00:00Z");
// The canned first instant after the unchanged mark at which some file's text differs.
export const FIXTURE_NEXT_CHANGE_AT = new Date("2026-06-03T18:20:00Z");

// Pasted from the real shape of listSnapLines; check F6 compares them with the page.
const FIRST_SNAP_LINES = [
  "src/index.ts: @v2 📸 at 2026-06-01T09:05:00.000Z",
  "README.md: a1b2c3d4 at 2026-06-01T09:00:00.000Z",
];
const SECOND_SNAP_LINES = [
  "src/index.ts: e4f5a6b7 at 2026-06-01T14:30:00.000Z",
  "README.md: a1b2c3d4 at 2026-06-01T09:00:00.000Z",
  "src/util.ts: @v2 📸 at 2026-06-03T10:30:00.000Z",
  "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts: [e] at 2026-06-03T09:10:00.000Z",
];

function buildCannedMessage(markAt: Date, skippedLine: string[], snapLines: string[]): string {
  const markInstant = markAt.toISOString();
  const sections = [[`jfred: reconstruct to ${markInstant}`], skippedLine, snapLines];
  sections.push([`Author-Date: ${markInstant}`, `Commit-Date: ${WALL_CLOCK}`, `reconstructed by JFRED @ ${WALL_CLOCK}`]);
  let message = "";
  for (const section of sections) {
    if (section.length > 0)
      message += `${message === "" ? "" : "\n\n"}${section.join("\n")}`;
  }
  return message;
}

export function buildFixtureJfredCommits(): Layer1WireView["jfredCommits"] {
  return {
    isCanned: true,
    base: { instant: JFRED_BASE_AT, shortHash: BASE_HASH },
    commits: [
      { instant: FIRST_MARK_AT, shortHash: "c0ffee01", parentShortHash: BASE_HASH, message: buildCannedMessage(FIRST_MARK_AT, [], FIRST_SNAP_LINES) },
      {
        instant: SECOND_MARK_AT,
        shortHash: "c0ffee02",
        parentShortHash: "c0ffee01",
        message: buildCannedMessage(SECOND_MARK_AT, ["includes 4 unmarked changes"], SECOND_SNAP_LINES),
      },
    ],
  };
}
