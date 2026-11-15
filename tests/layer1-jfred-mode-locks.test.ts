// Test for webapp/layer1-components/commits-column/layer1-jfred-mode.ts: Commit mode on locks the Committer/Author and Reverse buttons.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { readJfredBranch, setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { handleBarsHistoryLoaded } = await import("../webapp/layer1-components/commits-column/layer1-jfred-mode.ts");
const { BarsViewMode, setBarsViewMode } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");
const { installReverseToggle, resetReverseToggle } = await import("../webapp/layer1-components/top-bars/layer1-reverse-toggle.ts");

const LOADER_PATHNAMES = ["/api/layer1-edits", "/api/layer1-script-runs", "/api/layer1-branches"];

function buildRealView(): never {
  return { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [], jfredCommits: { commits: [] } } as never;
}

function getCommitModeButton(): HTMLButtonElement {
  return document.getElementById("commit-mode") as HTMLButtonElement;
}

function getCommitterButton(): HTMLButtonElement {
  return document.getElementById("time-committer") as HTMLButtonElement;
}

function getAuthorButton(): HTMLButtonElement {
  return document.getElementById("time-author") as HTMLButtonElement;
}

function getReverseButton(): HTMLButtonElement {
  return document.getElementById("reverse-toggle") as HTMLButtonElement;
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

// The three loader routes answer an empty stream; every other route answers an empty text.
function installLoaderRoutes(): void {
  const answer = async (url: unknown): Promise<Response> => {
    const pathname = new URL(String(url), "http://localhost:7343").pathname;
    if (!LOADER_PATHNAMES.includes(pathname))
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    return buildEmptyStreamResponse(pathname);
  };
  Object.assign(globalThis, { fetch: answer });
}

async function waitUntil(isDone: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50; turn++) {
    if (isDone())
      return;
    await waitForAsyncWork();
  }
}

// Fresh page in the Bubbles view (the only view that shows Reverse) with Commit mode off, Reverse off and the Commit mode button enabled.
async function renderBubblesViewWithCommitModeOff(): Promise<void> {
  initLayer1Dom();
  installLoaderRoutes();
  setArmed(false);
  resetReverseToggle();
  installReverseToggle();
  setBarsViewMode(BarsViewMode.bubbles);
  await renderLayer1View(buildRealView());
  enableCommitModeForLoadedProject();
}

async function turnCommitModeOnFromButton(): Promise<void> {
  getCommitModeButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
}

async function turnCommitModeOffFromButton(): Promise<void> {
  getCommitModeButton().click();
  await waitUntil(() => !readJfredBranch().isArmed);
}

test("test_commit_mode_on_disables_the_committer_and_author_buttons", async () => {
  // Verify: after the click that turns Commit mode on, both time buttons are disabled.
  await renderBubblesViewWithCommitModeOff();
  assert.equal(getCommitterButton().disabled, false);
  assert.equal(getAuthorButton().disabled, false);
  await turnCommitModeOnFromButton();
  assert.equal(getCommitterButton().disabled, true);
  assert.equal(getAuthorButton().disabled, true);
});

test("test_commit_mode_on_disables_the_reverse_button", async () => {
  // Verify: after the click that turns Commit mode on, the Reverse button is disabled.
  await renderBubblesViewWithCommitModeOff();
  assert.equal(getReverseButton().disabled, false);
  await turnCommitModeOnFromButton();
  assert.equal(getReverseButton().disabled, true);
});

test("test_reverse_on_then_commit_mode_on_turns_reverse_off_and_disables_it", async () => {
  // Verify: Reverse is on, then Commit mode goes on: Reverse loses its current class and is disabled.
  await renderBubblesViewWithCommitModeOff();
  getReverseButton().click();
  assert.equal(getReverseButton().classList.contains("current"), true);
  await turnCommitModeOnFromButton();
  assert.equal(getReverseButton().classList.contains("current"), false);
  assert.equal(getReverseButton().disabled, true);
});

test("test_commit_mode_off_enables_both_controls_again_and_reverse_stays_off", async () => {
  // Verify: Reverse on, Commit mode on, Commit mode off: the three buttons are enabled and Reverse is not current.
  await renderBubblesViewWithCommitModeOff();
  getReverseButton().click();
  await turnCommitModeOnFromButton();
  await turnCommitModeOffFromButton();
  assert.equal(getCommitterButton().disabled, false);
  assert.equal(getAuthorButton().disabled, false);
  assert.equal(getReverseButton().disabled, false);
  assert.equal(getReverseButton().classList.contains("current"), false);
});
