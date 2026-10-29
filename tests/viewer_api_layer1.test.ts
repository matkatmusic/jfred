// Task 235: GET /api/layer1-view path half and bad-input rejections; placement lives in viewer_api_layer1_placement.test.ts.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    buildViewUrl,
    createFixtureDiskFolder,
    createFixtureRepo,
    fetchFixtureView,
    launchFixtureViewer,
} from "./layer1-view-test-helpers.ts";

// Ports 17400, 17900, 18400 and 19400 belong to other test files.
const SCRATCH_PORT = 18900 + (process.pid % 500);

const diskDir = createFixtureDiskFolder();
const repoDir = createFixtureRepo();
let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await launchFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

test("test_layer1_view_endpoint_pairs_disk_files_against_the_repo_tree", async () => {
    // The folder and repo overlap on one path; the endpoint answers 200 with three buckets.
    const view = await fetchFixtureView(SCRATCH_PORT, diskDir, repoDir);
    // `pairs` holds exactly the path present in BOTH roots.
    assert.deepEqual(view.pairs.map((pair) => pair.path), ["shared.txt"]);
    // `gitOrphans` holds the repo-only path; assert CONTENT, since swapped buckets match in size.
    assert.deepEqual(view.gitOrphans.map((orphan) => orphan.path), ["repo-only.txt"]);
    // `diskOrphans` holds the disk-only paths, ordered by INSTANT, not by walk order.
    assert.deepEqual(view.diskOrphans.map((orphan) => orphan.path), ["early.txt", "disk-only.txt"]);
});

test("test_layer1_view_endpoint_rejects_a_ref_that_does_not_resolve", async () => {
    // A bad typed `ref` is a displayable client error: never a 500, never a stack trace.
    const response = await fetch(buildViewUrl(SCRATCH_PORT, { dir: diskDir, repo: repoDir, ref: "no-such-ref" }));
    assert.equal(response.status, 400);
    const body = await response.text();
    // the message names the offending ref...
    assert.ok(body.includes("no-such-ref"), body);
    // ...and carries no stack frame, so nothing internal leaks to the page.
    assert.ok(!body.includes("\n    at "), body);
});

test("test_layer1_view_endpoint_rejects_inputs_that_are_not_a_folder_and_a_repo", async () => {
    // Each bad dir or repo form is a 400; a missing folder names itself in the error.
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
