// Task 603: appendJfredPatch (layer1-jfred-patch.ts) writes a jfred commit's patch under its message in the Details drawer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { openJfredMessage } = await import("../webapp/layer1-components/commits-column/layer1-jfred-drawer.ts");
const { appendJfredPatch } = await import("../webapp/layer1-components/commits-column/layer1-jfred-patch.ts");

const COMMITTED = {
  shortHash: "c0ffee01",
  parentShortHash: "a1b2c3d4",
  instant: "2026-06-01T09:05:00.000Z",
  message: "jfred: reconstruct to 2026-06-01T09:05:00.000Z\n\nreconstructed by JFRED @ 2026-11-03T12:00:00Z",
};

test("test_appendJfredPatch_writes_the_patch_under_the_message_of_the_shown_commit", async () => {
  // Scenario: a commit is shown in the drawer; the server returns its patch.
  // Steps: open the message of commit c0ffee01, stub fetch to answer the patch, append, wait.
  initLayer1Dom();
  const urls: string[] = [];
  Object.assign(globalThis, {
    fetch: async (url: unknown): Promise<Response> => {
      urls.push(String(url));
      return { ok: true, status: 200, text: async () => "diff --git a/a.txt b/a.txt\n-first\n+second" } as unknown as Response;
    },
  });
  openJfredMessage(COMMITTED);
  await appendJfredPatch("c0ffee01");
  // Expect: one GET to the patch route with the hash, and a pre.jfred-patch with the text inside #dbody.
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /^\/api\/layer1-jfred-patch\?.*hash=c0ffee01/);
  assert.equal(document.querySelector("#dbody pre.jfred-patch")!.textContent, "diff --git a/a.txt b/a.txt\n-first\n+second");
});

test("test_appendJfredPatch_writes_nothing_when_another_commit_is_shown_by_then", async () => {
  // Scenario: the user opens commit B while the patch of commit A is still on its way.
  // Steps: show A, start appending A's patch, show B, let the reply arrive.
  initLayer1Dom();
  Object.assign(globalThis, {
    fetch: async (): Promise<Response> => ({ ok: true, status: 200, text: async () => "patch of A" }) as unknown as Response,
  });
  openJfredMessage(COMMITTED);
  const appending = appendJfredPatch("c0ffee01");
  openJfredMessage({ ...COMMITTED, shortHash: "c0ffee02" });
  await appending;
  // Expect: no patch in the drawer, because it now shows c0ffee02.
  assert.equal(document.querySelector("#dbody pre.jfred-patch"), null);
});

test("test_appendJfredPatch_throws_when_the_server_answers_an_error", async () => {
  // Scenario: the server answers 400; the failure must be loud, not hidden.
  initLayer1Dom();
  Object.assign(globalThis, {
    fetch: async (): Promise<Response> => ({ ok: false, status: 400, text: async () => "not a commit hash: zz" }) as unknown as Response,
  });
  openJfredMessage(COMMITTED);
  await assert.rejects(appendJfredPatch("c0ffee01"), /not a commit hash/);
});
