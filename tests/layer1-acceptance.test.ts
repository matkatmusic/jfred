// Task 238 (spec S18): the MILESTONE ACCEPTANCE TEST. Every other Layer 1 test exercises one half — the endpoint against a fixture, or the page against a canned view. This one runs the whole path: a real folder and a real UNRELATED repo, through the real GET /api/layer1-view on a spawned viewer, into the real page render in happy-dom. The page's relative fetch is forwarded to the live origin (forwardFetchToOrigin); nothing about the view is canned.
//
// Pixel offsets are deliberately NOT asserted here — tests/viewer_api_layer1_placement.test.ts owns placement. This file asserts the user's acceptance criterion: two buckets, zero pairs, and every path in the correct bucket.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import {
    SUBMODULE_FIXTURE_FOLDER,
    makeSubmoduleFixtureRoot,
    makeUnrelatedFixtureDiskFolder,
    makeUnrelatedFixtureRepo,
    startFixtureViewer,
} from "./layer1-view-test-helpers.ts";
import { forwardFetchToOrigin, setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// Own port range: 18900+ and 19400+ are claimed by the two viewer_api_layer1 files, each reserving 500 through `process.pid % 500`.
const SCRATCH_PORT = 19900 + (process.pid % 500);

const diskDir = makeUnrelatedFixtureDiskFolder();
const repoDir = makeUnrelatedFixtureRepo();
// ONE root serving as both the project folder and the repo — the submodule-exclusion case.
const submoduleRoot = makeSubmoduleFixtureRoot();

let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await startFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

// Boot the page against the LIVE endpoint and wait for its render to finish.
//
// bootLayer1Page() must run for EVERY document, not once: it is what seeds the header boxes from the page URL, and loadLayer1View reads those BOXES rather than the URL — an unseeded document makes it bail at its own missing-dir/repo guard and render nothing. node's module cache runs the module's own top-level boot only on the first import, so every later test needs this call.
//
// loadLayer1View is then awaited rather than flushAsyncWork()'d: that helper is three zero-delay macrotask turns, written for a stub that resolves immediately, and a real HTTP round trip plus the endpoint's git subprocesses will not reliably fit inside it. boot's own fire-and-forget load renders the same view, so the two cannot disagree.
async function renderPageAgainstLiveEndpoint(dir: string = diskDir, repo: string = repoDir): Promise<void> {
    const search = `?dir=${encodeURIComponent(dir)}&repo=${encodeURIComponent(repo)}`;
    setupLayer1Dom(search);
    forwardFetchToOrigin(`http://127.0.0.1:${SCRATCH_PORT}`);
    const { bootLayer1Page, loadLayer1View } = await import("../webapp/layer1-page.ts");
    bootLayer1Page();
    await loadLayer1View();
}

function listMatching(selector: string): HTMLElement[] {
    return [...document.querySelectorAll(selector)] as HTMLElement[];
}

// A bucket's identity is its TITLE, never its position or its size — the two buckets are mirror images, so finding one by index would let an inverted binding pass.
function findBucketTitled(title: string): HTMLElement | undefined {
    return listMatching("#stage .filebox.bucket")
        .find((bucket) => bucket.querySelector(".fname")?.textContent === title);
}

function listBucketPaths(bucket: HTMLElement): (string | null)[] {
    return [...bucket.querySelectorAll("li span")].map((row) => row.textContent);
}

// Every path named by EITHER bucket, so a claim about "no bucket mentions X" cannot pass by looking in the wrong direction.
function listEveryBucketPath(): (string | null)[] {
    return listMatching("#stage .filebox.bucket").flatMap(listBucketPaths);
}

test("test_unrelated_roots_render_zero_pair_widgets", async () => {
    // Scenario (task 238, spec S18): when the folder and the repo share no relative path, there is nothing to pair, so the stage draws no pair widget at all and says so.  Steps: render the page against the live endpoint with two unrelated roots.
    await renderPageAgainstLiveEndpoint();
    // no pair widget is drawn — `:not(.bucket)` excludes the two orphan buckets, which are also .filebox elements.
    assert.equal(listMatching("#stage .filebox:not(.bucket)").length, 0);
    // and the empty-state message stands in for them.
    assert.equal(document.querySelector("#stage .nopairs")?.textContent, "No git ↔ on-disk pairs.");
});

test("test_unrelated_roots_render_exactly_the_two_orphan_buckets", async () => {
    // Scenario: with both directions non-empty, S18 draws BOTH buckets and omits neither.  Steps: render the page against the live endpoint with two unrelated roots.
    await renderPageAgainstLiveEndpoint();
    // exactly two buckets exist, and each is identified by title rather than by count alone.
    assert.equal(listMatching("#stage .filebox.bucket").length, 2);
    assert.notEqual(findBucketTitled("No on-disk match"), undefined);
    assert.notEqual(findBucketTitled("No repository match"), undefined);
});

test("test_every_repo_path_and_every_disk_path_lands_in_its_own_bucket", async () => {
    // Scenario (spec S18 "Output contract"): every repo file belongs under "No on-disk match" and every disk file under "No repository match". The two sets are mirror images, so this asserts WHICH PATH is in WHICH bucket — a swap would leave both counts identical.  Steps: render the page against the live endpoint with two unrelated roots.
    await renderPageAgainstLiveEndpoint();
    // the repo's two tracked paths, repo-relative and oldest commit first (10:00 then 15:00).
    assert.deepEqual(listBucketPaths(findBucketTitled("No on-disk match")!), ["alpha.py", "docs/readme.md"]);
    // the folder's two files, oldest mtime first (09:00 then 12:00 the next day).
    assert.deepEqual(listBucketPaths(findBucketTitled("No repository match")!), ["notes.txt", "todo.md"]);
});

test("test_layer1_view_reports_no_orphan_for_a_submodules_contents", async () => {
    // Scenario: the submodule's files belong to another repository, so neither bucket mentions them and the gitlink itself is not a phantom repo-only row. Against the real jfred repo this is 10,884 rows of noise; here it is one file inside vendor/lib.  Steps: request the view for a repo that has one tracked file and one submodule.
    await renderPageAgainstLiveEndpoint(submoduleRoot, submoduleRoot);
    const bucketPaths = listEveryBucketPath();
    // the submodule's CONTENTS are absent — the walk never descended into the folder at all.
    for (const path of bucketPaths) {
        assert.equal(path?.startsWith(`${SUBMODULE_FIXTURE_FOLDER}/`), false, `${path} is submodule content`);
    }
    // and the gitlink itself is not a phantom "No on-disk match" row either: `git ls-tree -r` reports it as one bare directory name, which pairing would otherwise treat as a file.
    assert.equal(bucketPaths.includes(SUBMODULE_FIXTURE_FOLDER), false);
    // the root's own tracked file still pairs, so the exclusion did not over-reach.
    assert.ok(listMatching("#stage .filebox:not(.bucket) .fname")
        .some((name) => name.textContent === "kept.txt"));
});
