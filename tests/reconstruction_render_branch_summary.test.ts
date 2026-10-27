import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBranchSummary } from "../src/reconstruction_render_branch_summary.ts";
import type { FileHistory } from "../src/reconstruction_events.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const oneHistory: FileHistory = { target: new Path("/a/one.py"), revisions: [] };
const histories: FileHistory[] = [oneHistory, { target: new Path("/a/two.py"), revisions: [] }];

// The summary has a surviving line and a rewound line with its rewind point.
test("test_branch_summary_lists_surviving_and_rewound_lines", () => {
  const out = renderBranchSummary({
    survivingTip: new Uuid("aaaaaaaa-1111"),
    surviving: histories,
    rewound: [{ tip: new Uuid("bbbbbbbb-2222"), rewindPoint: new Uuid("cccccccc-3333"), histories: [oneHistory] }],
  });
  assert.equal(
    out,
    "surviving  tip #aaaaaaaa    one.py, two.py\nrewound    tip #bbbbbbbb  rewind @ #cccccccc    one.py",
  );
});
