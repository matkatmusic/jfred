// The view URL run.ts drives; importing run.ts must not start a browser.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildViewUrl } from "../scripts/visual/run.ts";

// test("the view URL carries both Layer 1 sources as query params", () => {
//     const url = new URL(buildViewUrl(9999));
//     assert.equal(url.port, "9999");
//     assert.equal(url.pathname, "/app/layer1.html");
//     assert.ok(url.searchParams.get("dir")?.endsWith("jfred"));
//     assert.ok(url.searchParams.get("repo")?.endsWith("jfred"));
// });

test("test_the_view_url_carries_dir_and_repo_from_the_debug_config", () => {
    // Scenario: the debug config holds both a dir and a repo.
    // Steps:
    // build the view URL for port 9999 from a config that has dir and repo.
    const url = new URL(buildViewUrl(9999, { dir: "/work/jfred", repo: "/work/jfred" }));
    // the URL names the port that was given.
    assert.equal(url.port, "9999");
    // the URL points at the Layer 1 page.
    assert.equal(url.pathname, "/app/layer1.html");
    // the URL carries the dir from the config.
    assert.equal(url.searchParams.get("dir"), "/work/jfred");
    // the URL carries the repo from the config.
    assert.equal(url.searchParams.get("repo"), "/work/jfred");
});

test("test_the_view_url_throws_when_the_debug_config_has_no_dir_or_no_repo", () => {
    // Scenario: the debug config file is missing (no fields) or holds only a dir.
    // Steps:
    // an empty config has neither field: the error names the file, then "dir", then "repo".
    assert.throws(() => buildViewUrl(9999, {}), /debugConfig\.json.*"dir".*"repo"/);
    // a config with only a dir lacks the repo: the error is the same.
    assert.throws(() => buildViewUrl(9999, { dir: "/work/jfred" }), /debugConfig\.json.*"dir".*"repo"/);
});

