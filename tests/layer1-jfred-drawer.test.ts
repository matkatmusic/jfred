// Test for webapp/layer1-jfred-drawer.ts: the commit message in the Details drawer, with an optional Commit button.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { openJfredMessage } = await import("../webapp/layer1-components/commits-column/layer1-jfred-drawer.ts");

const COMMITTED = {
  shortHash: "c0ffee01",
  parentShortHash: "a1b2c3d4",
  instant: "2026-06-01T09:05:00.000Z",
  message: "jfred: reconstruct to 2026-06-01T09:05:00.000Z\n\nreconstructed by JFRED @ 2026-11-03T12:00:00Z",
};

function readText(id: string): string {
  return document.getElementById(id)!.textContent!;
}

test("test_the_drawer_opens_with_the_header_the_meta_and_the_message", () => {
  // Verify: #drawer opens, #dpath and #dmeta are written, the pre holds the message.
  initLayer1Dom();
  openJfredMessage(COMMITTED);
  assert.equal(document.getElementById("drawer")!.classList.contains("open"), true);
  assert.equal(readText("dpath"), "jfred commit c0ffee01");
  assert.equal(readText("dmeta"), "parent a1b2c3d4 | author date 2026-06-01T09:05:00.000Z");
  assert.equal(document.querySelector("#dbody pre.jfred-message")!.textContent, COMMITTED.message);
});

test("test_a_pending_view_names_itself_pending", () => {
  // Verify: no hash yet, so the header says pending.
  initLayer1Dom();
  openJfredMessage({ ...COMMITTED, shortHash: undefined });
  assert.equal(readText("dpath"), "jfred commit (pending)");
});

test("test_there_is_no_commit_button_without_a_callback", () => {
  // Verify: the button exists only when a callback is passed.
  initLayer1Dom();
  openJfredMessage(COMMITTED);
  assert.equal(document.getElementById("jfred-commit-button"), null);
});

test("test_the_commit_button_calls_the_callback", () => {
  // Verify: the button reads Commit and a click calls the callback once.
  initLayer1Dom();
  let calls = 0;
  openJfredMessage(COMMITTED, () => calls++);
  const button = document.getElementById("jfred-commit-button")!;
  assert.equal(button.textContent, "Commit");
  button.click();
  assert.equal(calls, 1);
});

test("test_the_step_buttons_and_copy_link_are_hidden", () => {
  // Verify: a commit message has no revisions to step through and no node link.
  initLayer1Dom();
  openJfredMessage(COMMITTED);
  assert.equal((document.getElementById("dprev") as HTMLButtonElement).hidden, true);
  assert.equal((document.getElementById("dnext") as HTMLButtonElement).hidden, true);
  assert.equal((document.getElementById("dcopylink") as HTMLButtonElement).hidden, true);
});

test("test_a_second_open_replaces_the_first_body", () => {
  // Verify: the pane with the button is gone after an open without a callback.
  initLayer1Dom();
  openJfredMessage(COMMITTED, () => undefined);
  openJfredMessage(COMMITTED);
  assert.equal(document.querySelectorAll("#dbody .jpane").length, 1);
  assert.equal(document.getElementById("jfred-commit-button"), null);
});
