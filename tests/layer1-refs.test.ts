// The Layer 1 branch and commit dropdowns fill from /api/layer1-refs and write the pick into the #ref box.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { fillRefsFromRepo, registerRefPickers } from "../webapp/layer1-refs.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const REFS_BODY = {
  branches: ["main", "dev"],
  head: "main",
  commits: [{ hash: "abcdef1234567890", subject: "first commit", date: "2026-01-01" }],
};

function getRepoRow(): Element {
  return document.querySelector(".sources.repo")!;
}

function stubFetchRefs(): void {
  globalThis.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve(REFS_BODY) })) as unknown as typeof fetch;
}

test("fills both pickers and shows them when the repo answers", async () => {
  initLayer1Dom();
  stubFetchRefs();
  getInputById("repo").value = "/some/repo";
  getInputById("ref").value = "dev";
  await fillRefsFromRepo();
  assert.equal((getRequiredElementById("branch") as HTMLSelectElement).value, "dev");
  assert.equal(getRequiredElementById("commit").children.length, 2);
  assert.ok(getRepoRow().classList.contains("repo-ok"));
});

test("hides the pickers when the repo box is empty", async () => {
  initLayer1Dom();
  getRepoRow().classList.add("repo-ok");
  getInputById("repo").value = "  ";
  await fillRefsFromRepo();
  assert.ok(!getRepoRow().classList.contains("repo-ok"));
});

test("hides the pickers when the server is unreachable", async () => {
  initLayer1Dom();
  globalThis.fetch = (() => Promise.reject(new Error("down"))) as typeof fetch;
  getRepoRow().classList.add("repo-ok");
  getInputById("repo").value = "/some/repo";
  await fillRefsFromRepo();
  assert.ok(!getRepoRow().classList.contains("repo-ok"));
});

test("a branch pick writes the ref box and reloads, a commit pick only writes it", async () => {
  initLayer1Dom();
  stubFetchRefs();
  getInputById("repo").value = "/some/repo";
  await fillRefsFromRepo();
  let reloads = 0;
  registerRefPickers(() => { reloads += 1; });
  const branch = getRequiredElementById("branch") as HTMLSelectElement;
  branch.value = "dev";
  branch.dispatchEvent(new window.Event("change"));
  assert.equal(getInputById("ref").value, "dev");
  assert.equal(reloads, 1);
  const commit = getRequiredElementById("commit") as HTMLSelectElement;
  commit.value = "abcdef1234567890";
  commit.dispatchEvent(new window.Event("change"));
  assert.equal(getInputById("ref").value, "abcdef1234567890");
  assert.equal(reloads, 1);
});
