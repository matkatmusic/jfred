import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByTarget, renderChosen } from "../src/reconstruction_render_chosen.ts";
import { parseArgs } from "../src/reconstruction_cli_args.ts";
import type { FileHistory } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

function createHistory(path: string): FileHistory {
  const revision = { kind: EventKind.write, changeId: new Uuid("w1"), timestamp: new Date("2026-01-01T00:00:00Z"), lines: [] };
  return { target: new Path(path), revisions: [revision] };
}

// filterByTarget keeps only the history whose final path matches.
test("test_filter_by_target_keeps_matching_history", () => {
  const histories = [createHistory("/a/one.py"), createHistory("/a/two.py")];
  const matching = filterByTarget(histories, new Path("/a/two.py"));
  assert.deepEqual(matching, [histories[1]]);
});

// filterByTarget returns every history when no target is given.
test("test_filter_by_target_without_target_keeps_all", () => {
  const histories = [createHistory("/a/one.py"), createHistory("/a/two.py")];
  assert.deepEqual(filterByTarget(histories, undefined), histories);
});

// The default view is the list; the verbose view puts each path under a ### header.
test("test_render_chosen_picks_view_from_options", () => {
  const histories = [createHistory("/a/one.py")];
  const listOut = renderChosen(histories, parseArgs(["t.jsonl"]));
  const verboseOut = renderChosen(histories, parseArgs(["t.jsonl", "--verbose"]));
  assert.ok(!listOut.includes("###"));
  assert.ok(verboseOut.startsWith("### /a/one.py\n"));
});
