// Test for webapp/layer1-jfred-mode.ts: arming Commit mode turns on every node type, through a click on the button.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { readJfredBranch, setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { handleBarsHistoryLoaded } = await import("../webapp/layer1-components/commits-column/layer1-jfred-mode.ts");
const { BarsViewMode, setBarsViewMode } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");

const LOADER_PATHNAMES = ["/api/layer1-edits", "/api/layer1-script-runs", "/api/layer1-branches"];
const KINDS_NOT_LOADED_TEXT = "Commit mode needs every node type, and one did not load. Commit mode stays off.";

function buildRealView(): never {
  return { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [], jfredCommits: { commits: [] } } as never;
}

function getButton(): HTMLButtonElement {
  return document.getElementById("commit-mode") as HTMLButtonElement;
}

// Stands in for the end of the change history load of the loaded project.
function enableCommitModeForLoadedProject(): void {
  handleBarsHistoryLoaded((document.getElementById("dir") as HTMLInputElement).value.trim());
}

function buildEmptyStreamResponse(pathname: string): Response {
  const reply = pathname === "/api/layer1-script-runs" ? { pairs: [], results: [] } : { pairs: [] };
  const encoded = new TextEncoder().encode(JSON.stringify(reply) + "\n");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
  return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

// The three loader routes answer an empty stream, except `failingPathname`, which answers 500; returns the loader routes asked.
function installLoaderRoutes(failingPathname: string | undefined): string[] {
  const requested: string[] = [];
  const answer = async (url: unknown): Promise<Response> => {
    const pathname = new URL(String(url), "http://localhost:7343").pathname;
    if (!LOADER_PATHNAMES.includes(pathname))
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    requested.push(pathname);
    if (pathname === failingPathname)
      return { ok: false, status: 500, text: async () => "loader failed" } as unknown as Response;
    return buildEmptyStreamResponse(pathname);
  };
  Object.assign(globalThis, { fetch: answer });
  return requested;
}

async function waitUntil(isDone: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50; turn++) {
    if (isDone())
      return;
    await waitForAsyncWork();
  }
}

function listKindBoxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>("#timelineViewControls input[data-kind]")];
}

test("test_arming_commit_mode_checks_every_kind_box_and_loads_edits", async () => {
  // Verify: one click loads edits, script runs and branches, checks every box and turns the mode on.
  initLayer1Dom();
  const requested = installLoaderRoutes(undefined);
  setArmed(false);
  await renderLayer1View(buildRealView());
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  assert.equal(readJfredBranch().isArmed, true);
  assert.deepEqual(requested, LOADER_PATHNAMES);
  assert.ok(listKindBoxes().length > 0);
  for (const box of listKindBoxes())
    assert.equal(box.checked, true);
});

test("test_arming_commit_mode_stays_off_with_a_toast_when_a_kind_does_not_load", async () => {
  // Verify: a failed branch load leaves the mode off, the branch box unchecked and the toast shown.
  initLayer1Dom();
  installLoaderRoutes("/api/layer1-branches");
  setArmed(false);
  await renderLayer1View(buildRealView());
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => !document.getElementById("dtoast")!.hidden);
  assert.equal(document.getElementById("dtoast")!.textContent, KINDS_NOT_LOADED_TEXT);
  assert.equal(readJfredBranch().isArmed, false);
  assert.equal(getButton().classList.contains("current"), false);
  assert.equal(document.querySelector<HTMLInputElement>("#timelineViewControls [data-kind=branch]")!.checked, false);
});

test("test_turning_commit_mode_off_leaves_the_kinds_on", async () => {
  // Verify: the second click turns the mode off and leaves every kind box checked.
  initLayer1Dom();
  installLoaderRoutes(undefined);
  setArmed(false);
  await renderLayer1View(buildRealView());
  enableCommitModeForLoadedProject();
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  getButton().click();
  await waitUntil(() => !readJfredBranch().isArmed);
  assert.equal(readJfredBranch().isArmed, false);
  assert.ok(listKindBoxes().length > 0);
  for (const box of listKindBoxes())
    assert.equal(box.checked, true);
});

function findKindBox(kind: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#timelineViewControls input[data-kind="${kind}"]`)!;
}

function findTimelineArea(): HTMLElement {
  return document.getElementById("barsTimelineArea")!;
}

// Renders the empty real view in `mode` and enables the button; returns the loader routes asked.
async function renderViewInMode(mode: typeof BarsViewMode[keyof typeof BarsViewMode]): Promise<string[]> {
  initLayer1Dom();
  const requested = installLoaderRoutes(undefined);
  setArmed(false);
  setBarsViewMode(mode);
  await renderLayer1View(buildRealView());
  enableCommitModeForLoadedProject();
  return requested;
}

async function armCommitModeFromButton(): Promise<void> {
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
}

test("test_in_bars_view_turning_commit_mode_on_leaves_edit_and_script_run_unticked", async () => {
  // Verify: in the Bars view the click arms the mode, loads nothing and leaves the two unticked boxes unticked.
  const requested = await renderViewInMode(BarsViewMode.bars);
  findKindBox("edit").checked = false;
  findKindBox("script-run").checked = false;
  await armCommitModeFromButton();
  assert.equal(readJfredBranch().isArmed, true);
  assert.deepEqual(requested, []);
  assert.equal(findKindBox("edit").checked, false);
  assert.equal(findKindBox("script-run").checked, false);
});

test("test_in_bars_view_turning_commit_mode_on_marks_the_button_current", async () => {
  // Verify: in the Bars view the button gets the class current once the mode is on.
  await renderViewInMode(BarsViewMode.bars);
  await armCommitModeFromButton();
  assert.equal(getButton().classList.contains("current"), true);
});

test("test_in_bubbles_view_turning_commit_mode_on_still_ticks_every_kind", async () => {
  // Verify: in the Bubbles view the click still loads the three routes and ticks the unticked Edit and script run boxes.
  const requested = await renderViewInMode(BarsViewMode.bubbles);
  findKindBox("edit").checked = false;
  findKindBox("script-run").checked = false;
  await armCommitModeFromButton();
  assert.deepEqual(requested, LOADER_PATHNAMES);
  assert.equal(findKindBox("edit").checked, true);
  assert.equal(findKindBox("script-run").checked, true);
});

test("test_turning_commit_mode_on_puts_the_commit_mode_on_class_on_the_timeline_area", async () => {
  // Verify: the click adds the class commitModeOn to #barsTimelineArea.
  await renderViewInMode(BarsViewMode.bars);
  assert.equal(findTimelineArea().classList.contains("commitModeOn"), false);
  await armCommitModeFromButton();
  assert.equal(findTimelineArea().classList.contains("commitModeOn"), true);
});

test("test_turning_commit_mode_off_removes_the_commit_mode_on_class", async () => {
  // Verify: the second click removes the class commitModeOn from #barsTimelineArea.
  await renderViewInMode(BarsViewMode.bars);
  await armCommitModeFromButton();
  getButton().click();
  await waitUntil(() => !readJfredBranch().isArmed);
  assert.equal(findTimelineArea().classList.contains("commitModeOn"), false);
});

test("test_the_commit_mode_on_class_stays_when_the_slider_moves_between_bars_and_bubbles", async () => {
  // Verify: moving the slider to Bubbles and back leaves the class commitModeOn on #barsTimelineArea.
  await renderViewInMode(BarsViewMode.bars);
  await armCommitModeFromButton();
  setBarsViewMode(BarsViewMode.bubbles);
  assert.equal(findTimelineArea().classList.contains("commitModeOn"), true);
  setBarsViewMode(BarsViewMode.bars);
  assert.equal(findTimelineArea().classList.contains("commitModeOn"), true);
});
