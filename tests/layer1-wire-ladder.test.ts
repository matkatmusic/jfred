// Per-file test for webapp/layer1-wire-ladder.ts: the node order of a bubble's ladder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findRejoinWithOwnSlot, listOrphanLadderInstants, listPairLadderInstants, listTrunkLadderInstants } from "../webapp/layer1-wire-ladder.ts";
import { WireRewindKind, type WireBranch } from "../webapp/layer1-wire-branches.ts";
import type { WireInstantOf, WireOrphanOf, WirePairOf } from "../webapp/layer1-wire.ts";

type Instant = WireInstantOf<string>;

function makeInstant(instant: string): Instant {
  return { instant, axisPx: 0 };
}

function makeBranch(rejoinInstant: string | undefined): WireBranch {
  return {
    rewindKind: WireRewindKind.conversation,
    forkAt: makeInstant("f"),
    ...(rejoinInstant === undefined ? {} : { rejoinAt: makeInstant(rejoinInstant) }),
    nodes: [{ ...makeInstant("n"), changeId: "c", label: "Edit" }],
  };
}

function makeFullPair(): WirePairOf<string, string, string> {
  return {
    path: "/a",
    commits: [{ ...makeInstant("commit"), hash: "h" }],
    onDisk: makeInstant("disk"),
    created: makeInstant("created"),
    snapshots: [{ ...makeInstant("snap"), version: 1, sessionId: "s", sessionFile: "/s.jsonl" }],
    edits: [{ ...makeInstant("edit") }] as never,
    scriptRuns: [{ ...makeInstant("run") }] as never,
    branches: [makeBranch("edit"), makeBranch("lone")],
  };
}

test("test_listTrunkLadderInstants_orders_created_commits_disk_snapshots_edits_runs", () => {
  // Verify: the trunk order is fixed.
  const instants = listTrunkLadderInstants(makeFullPair());
  assert.deepEqual(instants, ["created", "commit", "disk", "snap", "edit", "run"]);
});

test("test_listTrunkLadderInstants_skips_absent_optional_parts", () => {
  // Verify: a bare pair gives only its on-disk instant.
  const pair: WirePairOf<string, string, string> = { path: "/a", commits: [], onDisk: makeInstant("disk") };
  assert.deepEqual(listTrunkLadderInstants(pair), ["disk"]);
});

test("test_findRejoinWithOwnSlot_returns_only_a_rejoin_off_the_trunk", () => {
  // Verify: a trunk rejoin reuses its slot, an off-trunk rejoin owns one, no rejoin gives none.
  assert.equal(findRejoinWithOwnSlot(["edit"], makeBranch("edit")), undefined);
  assert.equal(findRejoinWithOwnSlot(["edit"], makeBranch("lone"))?.instant, "lone");
  assert.equal(findRejoinWithOwnSlot(["edit"], makeBranch(undefined)), undefined);
});

test("test_listPairLadderInstants_appends_each_branch_after_the_trunk", () => {
  // Verify: per branch the fork and nodes follow, and only an off-trunk rejoin adds a slot.
  const instants = listPairLadderInstants(makeFullPair());
  assert.deepEqual(instants, ["created", "commit", "disk", "snap", "edit", "run", "f", "n", "f", "n", "lone"]);
});

test("test_listOrphanLadderInstants_leads_with_the_orphan_then_snapshots", () => {
  // Verify: the orphan's own instant comes first.
  const orphan: WireOrphanOf<string, string, string> = {
    ...makeInstant("orphan"),
    path: "/a",
    snapshots: [{ ...makeInstant("snap"), version: 1, sessionId: "s", sessionFile: "/s.jsonl" }],
  };
  assert.deepEqual(listOrphanLadderInstants(orphan), ["orphan", "snap"]);
});
