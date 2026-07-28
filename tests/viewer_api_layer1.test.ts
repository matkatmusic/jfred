// Server test for task 235 (spec S18): GET /api/layer1-view?dir=&repo=&ref= serves the Layer 1 View — on-disk file state paired against a git tree. This file covers the PATH half (which paths land in `pairs` / `gitOrphans` / `diskOrphans`) plus the bad-input rejections. The axisPx PLACEMENT half is tests/viewer_api_layer1_placement.test.ts (task 240), split out when the task-240 cases pushed this file past the 250-line cap — precedent: tests/layered-app-widgets.ts carved out of tests/layered-app.test.ts for the same reason.
//
// The fixture (repo, folder, pinned instants) is shared with that file via tests/layer1-view-test-helpers.ts, but the viewer process is NOT: this file spawns and kills its own server on its own port.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    buildViewUrl,
    makeFixtureDiskFolder,
    makeFixtureRepo,
    requestFixtureView,
    startFixtureViewer,
} from "./layer1-view-test-helpers.ts";

// 17400 (viewer_server.test.ts), 17900 (viewer_api_layered.test.ts), 18400 (viewer_api_ladder.test.ts) and 19400 (viewer_api_layer1_placement.test.ts) are taken — parallel test files must never collide.
const SCRATCH_PORT = 18900 + (process.pid % 500);

const diskDir = makeFixtureDiskFolder();
const repoDir = makeFixtureRepo();
let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await startFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

test("test_layer1_view_endpoint_pairs_disk_files_against_the_repo_tree", async () => {
    // Scenario: the folder and the repo overlap on exactly one relative path.  Steps: the endpoint answers 200 with the three S18 buckets.
    const view = await requestFixtureView(SCRATCH_PORT, diskDir, repoDir);
    // `pairs` holds exactly the path present in BOTH roots.
    assert.deepEqual(view.pairs.map((pair) => pair.path), ["shared.txt"]);
    // `gitOrphans` holds exactly the repo path with no on-disk counterpart. Direction is load-bearing (S18): assert the CONTENT, since a swapped pair of buckets has the same sizes.
    assert.deepEqual(view.gitOrphans.map((orphan) => orphan.path), ["repo-only.txt"]);
    // `diskOrphans` holds exactly the on-disk paths with no repo entry, INSTANT-ascending rather than in the disk walk's path order (which would read disk-only.txt first).
    assert.deepEqual(view.diskOrphans.map((orphan) => orphan.path), ["early.txt", "disk-only.txt"]);
});

test("test_layer1_view_endpoint_rejects_a_ref_that_does_not_resolve", async () => {
    // Scenario: `ref` is typed into the header's box, so a bad one is a client error the page can display — never a 500 and never a stack trace.
    const response = await fetch(buildViewUrl(SCRATCH_PORT, { dir: diskDir, repo: repoDir, ref: "no-such-ref" }));
    assert.equal(response.status, 400);
    const body = await response.text();
    // the message names the offending ref...
    assert.ok(body.includes("no-such-ref"), body);
    // ...and carries no stack frame, so nothing internal leaks to the page.
    assert.ok(!body.includes("\n    at "), body);
});

test("test_layer1_view_endpoint_rejects_inputs_that_are_not_a_folder_and_a_repo", async () => {
    // Scenario: dir and repo arrive from paste-able text boxes, so each bad form is a 400.  a folder that is not on disk names itself in the error.
    const missingDir = join(tmpdir(), "layer1-view-definitely-not-here");
    const missingResponse = await fetch(buildViewUrl(SCRATCH_PORT, { dir: missingDir, repo: repoDir }));
    assert.equal(missingResponse.status, 400);
    assert.ok((await missingResponse.text()).includes(missingDir));
    // an omitted dir param names the param.
    const omittedResponse = await fetch(buildViewUrl(SCRATCH_PORT, { repo: repoDir }));
    assert.equal(omittedResponse.status, 400);
    assert.ok((await omittedResponse.text()).includes("dir"));
    // a repo path that is not a git repo fails at the git read, naming git.
    const notARepoResponse = await fetch(buildViewUrl(SCRATCH_PORT, { dir: diskDir, repo: diskDir }));
    assert.equal(notARepoResponse.status, 400);
    assert.ok((await notARepoResponse.text()).includes("git"));
});
