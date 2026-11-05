// The viewer start-up arguments of the computed-style capture: fixture mode adds --fixture, real mode does not.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRealPageUrl, listViewerArguments } from "../scripts/visual/computed-style-capture.ts";

const PATHS = { projectsDir: "/p", settingsFile: "/s.json", cacheFile: "/c.json" };

test("fixture mode ends the viewer arguments with --fixture", () => {
  const viewerArguments = listViewerArguments(7000, true, PATHS);
  assert.deepEqual(viewerArguments.slice(-1), ["--fixture"]);
  assert.ok(viewerArguments.includes("--settings-file"));
});

test("the real page url names the data folder as both folder and repo", () => {
  const url = new URL(buildRealPageUrl(7000, "/frozen/jfred"));
  assert.equal(url.searchParams.get("dir"), "/frozen/jfred");
  assert.equal(url.searchParams.get("repo"), "/frozen/jfred");
});

test("real mode passes no --fixture and keeps the throwaway settings file", () => {
  const viewerArguments = listViewerArguments(7000, false, PATHS);
  assert.ok(!viewerArguments.includes("--fixture"));
  assert.equal(viewerArguments[viewerArguments.indexOf("--settings-file") + 1], "/s.json");
});
