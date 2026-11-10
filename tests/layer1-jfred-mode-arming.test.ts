// Test for webapp/layer1-jfred-mode.ts: arming Commit mode turns on every node type, through a click on the button.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { readJfredBranch, setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

const LOADER_PATHNAMES = ["/api/layer1-edits", "/api/layer1-script-runs", "/api/layer1-branches"];
const KINDS_NOT_LOADED_TEXT = "Commit mode needs every node type, and one did not load. Commit mode stays off.";

function buildRealView(): never {
  return { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [], jfredCommits: { commits: [] } } as never;
}

function getButton(): HTMLButtonElement {
  return document.getElementById("commit-mode") as HTMLButtonElement;
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
  return [...document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]")];
}

test("test_arming_commit_mode_checks_every_kind_box_and_loads_edits", async () => {
  // Verify: one click loads edits, script runs and branches, checks every box and turns the mode on.
  initLayer1Dom();
  const requested = installLoaderRoutes(undefined);
  setArmed(false);
  await renderLayer1View(buildRealView());
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
  getButton().click();
  await waitUntil(() => !document.getElementById("dtoast")!.hidden);
  assert.equal(document.getElementById("dtoast")!.textContent, KINDS_NOT_LOADED_TEXT);
  assert.equal(readJfredBranch().isArmed, false);
  assert.equal(getButton().classList.contains("current"), false);
  assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=branch]")!.checked, false);
});

test("test_turning_commit_mode_off_leaves_the_kinds_on", async () => {
  // Verify: the second click turns the mode off and leaves every kind box checked.
  initLayer1Dom();
  installLoaderRoutes(undefined);
  setArmed(false);
  await renderLayer1View(buildRealView());
  getButton().click();
  await waitUntil(() => readJfredBranch().isArmed);
  getButton().click();
  await waitUntil(() => !readJfredBranch().isArmed);
  assert.equal(readJfredBranch().isArmed, false);
  assert.ok(listKindBoxes().length > 0);
  for (const box of listKindBoxes())
    assert.equal(box.checked, true);
});
