// Task 357: ticking the branch box fetches the lanes once and each pair bubble draws one lane per branch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const COMMIT = { hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const ON_DISK = { instant: "2026-06-03T09:00:00.000Z", axisPx: 60 };
const MOVED_EDIT = { instant: "2026-06-02T09:50:00.000Z", kind: "edit", changeId: "toolu_lane_moved", confidence: "verified",
  sessionId: "fixture-0f3c9a7e", sessionFile: "/fixture/demo/projects/0f3c9a7e.jsonl" };
const KEPT_EDIT = { ...MOVED_EDIT, instant: "2026-06-02T09:55:00.000Z", changeId: "toolu_trunk_kept" };
const laneNode = (instant: string, changeId: string) => ({ instant, changeId, label: "edit" });
const CONVERSATION_LANE = { rewindKind: "conversation", forkAt: "2026-06-02T09:30:00.000Z", rejoinAt: COMMIT.instant,
  nodes: [laneNode("2026-06-02T09:35:00.000Z", "toolu_lane_a"), laneNode(MOVED_EDIT.instant, "toolu_lane_moved")] };
const KEPT_LANE = { rewindKind: "conversation", forkAt: "2026-06-02T09:40:00.000Z", keptToEnd: true,
  nodes: [laneNode("2026-06-02T09:45:00.000Z", "toolu_lane_b")] };
const CODE_LANE = { rewindKind: "code", forkAt: "2026-06-02T10:00:00.000Z", nodes: [laneNode("2026-06-02T10:10:00.000Z", "toolu_lane_c")] };

const VIEW = {
  pairs: [
    { path: "src/run.ts", commits: [COMMIT], onDisk: ON_DISK },
    { path: "src/plain.ts", commits: [COMMIT], onDisk: ON_DISK },
  ],
  gitOrphans: [],
  diskOrphans: [],
  ruler: [COMMIT, ON_DISK].map((node) => ({ instant: node.instant, axisPx: node.axisPx, eventCount: 2 })),
};

let branchRequests = 0;

async function loadPage(): Promise<void> {
  branchRequests = 0;
  setupLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
  stubStreamRoute("/api/layer1-view", [VIEW]);
  const viewFetch = globalThis.fetch;
  stubStreamRoute("/api/layer1-edits", [{ pairs: [{ path: "src/run.ts", edits: [MOVED_EDIT, KEPT_EDIT] }] }]);
  const editsFetch = globalThis.fetch;
  stubStreamRoute("/api/layer1-branches", [{ pairs: [{ path: "src/run.ts", branches: [CONVERSATION_LANE, KEPT_LANE, CODE_LANE] }] }]);
  const branchFetch = globalThis.fetch;
  Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
    const isBranchRequest = String(url).includes("/api/layer1-branches");
    branchRequests += isBranchRequest ? 1 : 0;
    const isEditsRequest = String(url).includes("/api/layer1-edits");
    return (isBranchRequest ? branchFetch : isEditsRequest ? editsFetch : viewFetch)(url as string, init);
  } });
  const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
  bootLayer1Page();
  await waitForAsyncWork();
}

function listMatching(selector: string): HTMLElement[] {
  return [...document.querySelectorAll(selector)] as HTMLElement[];
}

async function tickBox(kind: string): Promise<void> {
  const box = document.querySelector<HTMLInputElement>(`#show-row [data-kind=${kind}]`)!;
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitForAsyncWork();
}

function readBubble(path: string): HTMLElement {
  return listMatching("#stage .filebox").find((candidate) => candidate.querySelector(".fname")?.getAttribute("data-path") === path)!;
}

function readAxisPx(element: Element): number {
  return Number((element as HTMLElement).style.getPropertyValue("--axis-px"));
}

test("test_before_the_branch_box_is_ticked_no_lane_is_drawn_and_nothing_is_fetched", async () => {
  await loadPage();
  assert.equal(listMatching("#stage .blane").length, 0);
  assert.equal(branchRequests, 0);
  assert.match(document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds")!, /branch/);
});

test("test_ticking_the_branch_box_draws_one_lane_per_branch_after_one_fetch", async () => {
  await loadPage();
  await tickBox("branch");
  assert.equal(branchRequests, 1);
  assert.equal(listMatching("#stage .blane").length, 3);
  assert.equal(readBubble("src/plain.ts").querySelectorAll(".blane").length, 0);
  assert.equal(readBubble("src/run.ts").style.getPropertyValue("--lane-count"), "3");
  assert.doesNotMatch(document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds")!, /branch/);
  assert.equal(listMatching('#stage [class*="rewind"]').length, 0);
});

test("test_every_lane_has_a_split_elbow_and_the_rejoin_and_kept_lanes_have_a_merge_elbow", async () => {
  await loadPage();
  await tickBox("branch");
  const lanes = listMatching("#stage .blane");
  assert.deepEqual(lanes.map((lane) => lane.querySelectorAll(".split-elbow").length), [1, 1, 1]);
  assert.deepEqual(lanes.map((lane) => lane.querySelectorAll(".merge-elbow").length), [1, 1, 0]);
});

test("test_a_rejoin_elbow_lands_on_its_trunk_dot_and_a_kept_to_end_elbow_on_the_last_trunk_node", async () => {
  await loadPage();
  await tickBox("branch");
  const bubble = readBubble("src/run.ts");
  const commitDot = bubble.querySelector<HTMLElement>(`.node.n-commit`)!;
  const onDiskDot = bubble.querySelector<HTMLElement>(`.node.n-disk`)!;
  const [conversation, kept] = listMatching("#stage .blane");
  assert.equal(readAxisPx(conversation!.querySelector(".merge-elbow")!), readAxisPx(commitDot));
  assert.equal(readAxisPx(kept!.querySelector(".merge-elbow")!), readAxisPx(onDiskDot));
});

test("test_a_fork_elbow_sits_on_its_own_row_apart_from_every_trunk_dot", async () => {
  await loadPage();
  await tickBox("branch");
  const bubble = readBubble("src/run.ts");
  const trunkRows = listMatching("#stage .node").filter((dot) => bubble.contains(dot)).map(readAxisPx);
  const forkRows = listMatching("#stage .split-elbow").map(readAxisPx);
  assert.equal(new Set(forkRows).size, 3);
  assert.ok(forkRows.every((row) => !trunkRows.includes(row)));
});

test("test_a_trunk_edit_that_a_lane_also_holds_is_tagged_n_moved_and_others_are_not", async () => {
  await loadPage();
  await tickBox("edit");
  await tickBox("branch");
  const moved = listMatching('#stage [data-change-id="toolu_lane_moved"]');
  assert.ok(moved.length > 0 && moved.every((element) => element.classList.contains("n-moved")));
  const kept = listMatching('#stage [data-change-id="toolu_trunk_kept"]');
  assert.ok(kept.length > 0 && kept.every((element) => !element.classList.contains("n-moved")));
});

test("test_unticking_and_reticking_the_branch_box_never_fetches_again", async () => {
  await loadPage();
  await tickBox("branch");
  const box = document.querySelector<HTMLInputElement>("#show-row [data-kind=branch]")!;
  box.checked = false;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tickBox("branch");
  assert.equal(branchRequests, 1);
});
