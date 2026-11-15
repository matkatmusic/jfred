// Test for webapp/layer1-jfred-mode.ts: the Commit mode button, the once-per-page load and the saved base, through renderLayer1View.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { appendCommit, deleteJfredBranch, readJfredBranch, setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { handleBarsHistoryLoaded } = await import("../webapp/layer1-components/commits-column/layer1-jfred-mode.ts");
const { setCachedProjectSettings } = await import("../webapp/layer1-settings.ts");
const { moveDetailsPaneToRightEdge } = await import("../webapp/layer1-components/details-drawer/layer1-details-pane.ts");

// One ruler tick, because the Bars load that follows every render needs a ruler row.
const REAL_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [{ instant: "2026-06-01T09:00:00.000Z", axisPx: 10, eventCount: 1 }] };
const CANNED_VIEW = {
  ...REAL_VIEW,
  jfredCommits: {
    isCanned: true,
    base: { instant: "2026-06-01T09:00:00.000Z", shortHash: "a1b2c3d4" },
    commits: [
      { instant: "2026-06-01T09:05:00.000Z", shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "one" },
      { instant: "2026-06-03T10:30:00.000Z", shortHash: "c0ffee02", parentShortHash: "c0ffee01", message: "two" },
    ],
  },
};
const PROJECT_DIR = "/work/project";
const SAVED_HASH = "b7c8d9e0f1a23445566778899aabbccddeeff001";
const SAVED_COMMIT_INSTANT = "2026-06-02T09:00:00.000Z";
const SERVER_BASE = { instant: "2026-06-01T09:00:00.000Z", shortHash: "a1b2c3d4" };
const SERVER_COMMIT = { instant: "2026-06-01T09:05:00.000Z", shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "one" };
const OTHER_SERVER_COMMIT = { instant: "2026-06-01T09:06:00.000Z", shortHash: "c0ffee09", parentShortHash: "a1b2c3d4", message: "nine" };
const LOADER_PATHNAMES = ["/api/layer1-edits", "/api/layer1-script-runs", "/api/layer1-branches"];

function getButton(): HTMLButtonElement {
  return document.getElementById("commit-mode") as HTMLButtonElement;
}

function readDirValue(): string {
  return (document.getElementById("dir") as HTMLInputElement).value.trim();
}

// Stands in for the end of the change history load of the loaded project.
function enableCommitModeForLoadedProject(): void {
  handleBarsHistoryLoaded(readDirValue());
}

function buildEmptyStreamResponse(pathname: string): Response {
  const reply = pathname === "/api/layer1-script-runs" ? { pairs: [], results: [] } : pathname === "/api/layer1-inverse-repos" ? { files: [] } : { pairs: [] };
  const encoded = new TextEncoder().encode(JSON.stringify(reply) + "\n");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
  return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

// The three loader routes answer an empty stream; every POST is recorded.
function installLoaderRoutes(): { pathname: string; body: unknown }[] {
  const posted: { pathname: string; body: unknown }[] = [];
  const answer = async (url: unknown, init?: RequestInit): Promise<Response> => {
    const pathname = new URL(String(url), "http://localhost:7343").pathname;
    if (init?.method === "POST") {
      posted.push({ pathname, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    }
    if (pathname === "/api/layer1-inverse-repos")
      return buildEmptyStreamResponse(pathname);
    if (LOADER_PATHNAMES.includes(pathname))
      return buildEmptyStreamResponse(pathname);
    return { ok: false, status: 404, text: async () => `not stubbed ${pathname}` } as unknown as Response;
  };
  Object.assign(globalThis, { fetch: answer });
  return posted;
}

async function waitUntil(isDone: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50; turn++) {
    if (isDone())
      return;
    await waitForAsyncWork();
  }
}

function seedSavedHash(cachedDir: string, savedHash: string): void {
  (document.getElementById("dir") as HTMLInputElement).value = PROJECT_DIR;
  setCachedProjectSettings({ [cachedDir]: { dir: cachedDir, repo: "", branch: "", ref: "", jsonl: [], fileHistory: [], jfredBaseHash: savedHash } });
}

function buildRealViewWithSavedCommit(jfredCommits: unknown): never {
  const pair = {
    path: "src/run.ts",
    commits: [{ instant: SAVED_COMMIT_INSTANT, axisPx: 30, hash: SAVED_HASH }],
    onDisk: { instant: SAVED_COMMIT_INSTANT, axisPx: 40 },
  };
  return { ...REAL_VIEW, pairs: [pair], jfredCommits } as never;
}

test("test_real_data_leaves_the_button_hidden_and_draws_no_strip", async () => {
  // Verify: no jfredCommits field means no button, no strip and no listener.
  initLayer1Dom();
  await renderLayer1View(REAL_VIEW as never);
  assert.equal(getButton().hidden, true);
  assert.equal(document.getElementById("jfredCommitsDrawerComponent"), null);
  assert.equal(getButton().onclick, null);
});

test("test_fixture_data_shows_the_button_and_no_strip_until_commit_mode_is_on", async () => {
  // Verify: the button shows with its text; the strip needs Commit mode.
  initLayer1Dom();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(getButton().hidden, false);
  assert.equal(getButton().textContent, "Commit mode");
  assert.equal(document.getElementById("jfredCommitsDrawerComponent"), null);
});

test("test_the_click_draws_the_strip_and_a_second_click_removes_it", async () => {
  // Verify: Commit mode on shows the canned entries; off hides the column.
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode").length, 3);
  getButton().click();
  await waitUntil(() => !readJfredBranch().isArmed);
  assert.equal(document.getElementById("jfredCommitsDrawerComponent"), null);
});

test("test_the_button_toggles_current_and_the_armed_state", async () => {
  // Verify: one click arms and marks the button current; a second click undoes both.
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  assert.equal(readJfredBranch().isArmed, true);
  assert.equal(getButton().classList.contains("current"), true);
  getButton().click();
  await waitUntil(() => !readJfredBranch().isArmed);
  assert.equal(readJfredBranch().isArmed, false);
  assert.equal(getButton().classList.contains("current"), false);
});

test("test_the_commit_mode_button_moves_the_minimap", async () => {
  // Build a view with commit mode off.
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  // The ruler container ends at 321 px.
  const rulerContainer = document.getElementById("timelineRulerContainer")!;
  const fullRect = { left: 0, right: 321, top: 0, bottom: 0, width: 321, height: 0, x: 0, y: 0, toJSON() { return {}; } };
  Object.defineProperty(rulerContainer, "getBoundingClientRect", { configurable: true, value: () => fullRect });
  // Click the button and wait for commit mode to turn on.
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  // The minimap left edge is the ruler container edge.
  assert.equal(document.getElementById("minimapComponent")!.style.left, "321px");
  // Turn commit mode back off for the other tests.
  getButton().click();
  await waitUntil(() => !readJfredBranch().isArmed);
});

test("test_an_open_details_pane_gets_narrower_when_the_commits_drawer_goes_on", async () => {
  // Build a view with commit mode off and the details pane open.
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  const pane = document.getElementById("detailsPaneContainer")!;
  pane.classList.add("open");
  // The scroll box is 1200 px wide; the ruler ends at 200 px and the commits drawer would end at 304 px.
  const scrollBox = document.getElementById("timelineContainer")!;
  Object.defineProperty(scrollBox, "clientWidth", { configurable: true, value: 1200 });
  Object.defineProperty(scrollBox, "clientHeight", { configurable: true, value: 600 });
  const rightEdgeById: Record<string, number> = { timelineRulerComponent: 200, jfredCommitsDrawerComponent: 304, timelineContainer: 0 };
  const prototype = window.Element.prototype;
  const originalGetBoundingClientRect = prototype.getBoundingClientRect;
  prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const edge = rightEdgeById[this.id] ?? 0;
    const left = this.id === "timelineContainer" ? 0 : edge;
    return { left, right: edge, top: 0, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON() { return {}; } } as DOMRect;
  };
  try {
    // With commit mode off the pane is 35% of (1200 - 200).
    moveDetailsPaneToRightEdge();
    assert.equal(pane.style.width, "350px");
    // Turning commit mode on re-places the open pane: 35% of (1200 - 304).
    enableCommitModeForLoadedProject();
    getButton().click();
    await waitUntil(() => readJfredBranch().isArmed);
    assert.equal(pane.style.width, "313.6px");
  } finally {
    prototype.getBoundingClientRect = originalGetBoundingClientRect;
    // Turn commit mode back off for the other tests.
    getButton().click();
    await waitUntil(() => !readJfredBranch().isArmed);
  }
});

test("test_a_second_render_keeps_the_fake_commits", async () => {
  // Verify: a later render with the same wire view must not reload the canned branch.
  initLayer1Dom();
  appendCommit({ instant: "2026-06-03T18:20:00.000Z", shortHash: "c0ffee03", parentShortHash: "c0ffee02", message: "three" });
  installLoaderRoutes();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  assert.equal(readJfredBranch().commits.length, 3);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode").length, 4);
});

test("test_a_second_render_keeps_the_delete", async () => {
  // Verify: Delete stays done after another render; only a page reload brings the canned data back.
  initLayer1Dom();
  deleteJfredBranch();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(readJfredBranch().base, undefined);
  assert.equal(document.getElementById("jfredCommitsDrawerComponent"), null);
  assert.equal(getButton().hidden, false);
});

test("test_canned_view_ignores_the_saved_hash", async () => {
  // Verify: a canned view with no base keeps no base, whatever hash is saved, and saves nothing.
  initLayer1Dom();
  const posted = installLoaderRoutes();
  deleteJfredBranch();
  seedSavedHash(PROJECT_DIR, SAVED_HASH);
  await renderLayer1View(buildRealViewWithSavedCommit({ isCanned: true, commits: [] }));
  assert.equal(readJfredBranch().base, undefined);
  assert.deepEqual(posted, []);
});

test("test_real_view_shows_the_button_with_no_base", async () => {
  // Verify: a real view with no jfred branch yet shows the button and holds no base.
  initLayer1Dom();
  setCachedProjectSettings({});
  await renderLayer1View({ ...REAL_VIEW, jfredCommits: { commits: [] } } as never);
  assert.equal(getButton().hidden, false);
  assert.equal(readJfredBranch().base, undefined);
});

test("test_real_view_reload_replaces_commits_from_the_server", async () => {
  // Verify: each real render takes the commits of its own view, not the earlier ones.
  initLayer1Dom();
  setCachedProjectSettings({});
  await renderLayer1View({ ...REAL_VIEW, jfredCommits: { base: SERVER_BASE, commits: [SERVER_COMMIT] } } as never);
  assert.deepEqual(readJfredBranch().commits, [SERVER_COMMIT]);
  await renderLayer1View({ ...REAL_VIEW, jfredCommits: { base: SERVER_BASE, commits: [OTHER_SERVER_COMMIT] } } as never);
  assert.deepEqual(readJfredBranch().commits, [OTHER_SERVER_COMMIT]);
});

test("test_real_view_reload_restores_the_base_from_the_saved_hash_when_the_server_has_none", async () => {
  // Verify: the saved hash names a commit of the view, and the strip then shows it as the base.
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  seedSavedHash(PROJECT_DIR, SAVED_HASH);
  await renderLayer1View(buildRealViewWithSavedCommit({ commits: [] }));
  assert.deepEqual(readJfredBranch().base, { instant: SAVED_COMMIT_INSTANT, shortHash: SAVED_HASH.slice(0, 8) });
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode.j-base").length, 1);
});

test("test_real_view_reload_prefers_the_server_base_over_the_saved_hash", async () => {
  // Verify: a base from the server stays, and nothing is saved.
  initLayer1Dom();
  const posted = installLoaderRoutes();
  seedSavedHash(PROJECT_DIR, SAVED_HASH);
  await renderLayer1View(buildRealViewWithSavedCommit({ base: SERVER_BASE, commits: [] }));
  assert.deepEqual(readJfredBranch().base, SERVER_BASE);
  assert.deepEqual(posted, []);
});

test("test_real_view_reload_clears_a_saved_hash_that_no_commit_of_the_view_has", async () => {
  // Verify: no base appears, and the settings route receives an empty hash for the project folder.
  initLayer1Dom();
  const posted = installLoaderRoutes();
  seedSavedHash(PROJECT_DIR, "deadbeef00000000000000000000000000000000");
  await renderLayer1View(buildRealViewWithSavedCommit({ commits: [] }));
  assert.equal(readJfredBranch().base, undefined);
  assert.deepEqual(posted, [{ pathname: "/api/layer1-settings", body: { dir: PROJECT_DIR, jfredBaseHash: "" } }]);
});

test("test_real_view_reload_ignores_a_saved_hash_for_another_project_folder", async () => {
  // Verify: the saved hash is keyed by folder, so another folder's hash restores nothing and saves nothing.
  initLayer1Dom();
  const posted = installLoaderRoutes();
  seedSavedHash("/work/other-project", SAVED_HASH);
  await renderLayer1View(buildRealViewWithSavedCommit({ commits: [] }));
  assert.equal(readJfredBranch().base, undefined);
  assert.deepEqual(posted, []);
});

test("test_commit_mode_button_is_disabled_before_the_history_load_result", async () => {
  // Verify: a render shows the button, and it cannot be clicked until the history load ends.
  initLayer1Dom();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(getButton().hidden, false);
  assert.equal(getButton().disabled, true);
});

test("test_click_on_the_disabled_commit_mode_button_arms_nothing", async () => {
  // Verify: a click on the disabled button does not run the toggle.
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  assert.equal(readJfredBranch().isArmed, false);
});

test("test_commit_mode_button_is_enabled_after_the_result_for_the_loaded_project", async () => {
  // Verify: the result for the project in the dir box enables the button.
  initLayer1Dom();
  setArmed(false);
  (document.getElementById("dir") as HTMLInputElement).value = PROJECT_DIR;
  await renderLayer1View(CANNED_VIEW as never);
  handleBarsHistoryLoaded(PROJECT_DIR);
  assert.equal(getButton().disabled, false);
});

test("test_result_for_another_project_leaves_the_button_disabled", async () => {
  // Verify: a result for a project that is not in the dir box changes nothing.
  initLayer1Dom();
  setArmed(false);
  (document.getElementById("dir") as HTMLInputElement).value = PROJECT_DIR;
  await renderLayer1View(CANNED_VIEW as never);
  handleBarsHistoryLoaded("/work/other-project");
  assert.equal(getButton().disabled, true);
});

test("test_failed_history_load_keeps_the_button_disabled", async () => {
  // Verify: no result call after a render means the button stays disabled.
  initLayer1Dom();
  setArmed(false);
  (document.getElementById("dir") as HTMLInputElement).value = PROJECT_DIR;
  await renderLayer1View(CANNED_VIEW as never);
  await waitForAsyncWork();
  assert.equal(getButton().disabled, true);
});

test("test_new_project_load_disables_the_button_again", async () => {
  // Verify: the next render is a new project load, so the enabled button goes back to disabled.
  initLayer1Dom();
  setArmed(false);
  (document.getElementById("dir") as HTMLInputElement).value = PROJECT_DIR;
  await renderLayer1View(CANNED_VIEW as never);
  handleBarsHistoryLoaded(PROJECT_DIR);
  assert.equal(getButton().disabled, false);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(getButton().disabled, true);
});

test("test_new_project_load_disarms_commit_mode", async () => {
  // Verify: the next render turns Commit mode off and removes the class current from the button.
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  assert.equal(getButton().classList.contains("current"), true);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(readJfredBranch().isArmed, false);
  assert.equal(getButton().classList.contains("current"), false);
});

test("test_new_project_load_removes_the_commit_mode_on_class", async () => {
  // Verify: the next render removes the class commitModeOn from the Bars timeline area.
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  const timelineArea = document.getElementById("barsTimelineArea") as HTMLElement;
  assert.equal(timelineArea.classList.contains("commitModeOn"), true);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(timelineArea.classList.contains("commitModeOn"), false);
});
