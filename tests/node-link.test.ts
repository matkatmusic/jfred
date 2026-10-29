// buildPageUrl is the only pure part of the node-link browser check.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPageUrl } from "../scripts/visual/node-link.ts";

test("the page URL targets the port and keeps dir, repo and one jsonl", () => {
  const url = new URL(buildPageUrl(4321, {}));
  assert.equal(url.origin, "http://127.0.0.1:4321");
  assert.equal(url.pathname, "/app/layer1.html");
  assert.equal(url.searchParams.get("dir"), url.searchParams.get("repo"));
  assert.equal(url.searchParams.getAll("jsonl").length, 1);
});

test("extra params are added to the page URL", () => {
  const url = new URL(buildPageUrl(4321, { nodeLine: "2235" }));
  assert.equal(url.searchParams.get("nodeLine"), "2235");
});
