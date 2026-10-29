// Task 238: runs a real folder and repo through the live view route into the page.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { launchFixtureViewer } from "./layer1-view-test-helpers.ts";
import {
    SUBMODULE_FIXTURE_FOLDER,
    createSubmoduleFixtureRoot,
    createUnrelatedFixtureDiskFolder,
    createUnrelatedFixtureRepo,
} from "./layer1-unrelated-fixture-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installOriginForwardingFetch } from "./webapp-fetch-test-helpers.ts";

// Own port range: the two viewer_api_layer1 files already claim 18900+ and 19400+, 500 ports each.
const SCRATCH_PORT = 19900 + (process.pid % 500);

const diskDir = createUnrelatedFixtureDiskFolder();
const repoDir = createUnrelatedFixtureRepo();
// ONE root serving as both the project folder and the repo — the submodule-exclusion case.
const submoduleRoot = createSubmoduleFixtureRoot();

let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await launchFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

// Boot the page against the LIVE endpoint; call initLayer1Page() for EVERY document, then await loadLayer1View.
async function renderPageAgainstLiveEndpoint(dir: string = diskDir, repo: string = repoDir): Promise<void> {
    const search = `?dir=${encodeURIComponent(dir)}&repo=${encodeURIComponent(repo)}`;
    initLayer1Dom(search);
    installOriginForwardingFetch(`http://127.0.0.1:${SCRATCH_PORT}`);
    const { initLayer1Page, loadLayer1View } = await import("../webapp/layer1-page.ts");
    initLayer1Page();
    await loadLayer1View();
}

function listMatching(selector: string): HTMLElement[] {
    return [...document.querySelectorAll(selector)] as HTMLElement[];
}

// Find a bucket by TITLE, never by index: mirrored buckets would hide an inverted binding.
function findBucketTitled(title: string): HTMLElement | undefined {
    return listMatching("#stage .filebox.bucket")
        .find((bucket) => bucket.querySelector(".fname")?.textContent === title);
}

function listBucketPaths(bucket: HTMLElement): (string | null)[] {
    return [...bucket.querySelectorAll("li span")].map((row) => row.textContent);
}

// Every path named by EITHER bucket, so "no bucket mentions X" cannot pass by checking one direction.
function listEveryBucketPath(): (string | null)[] {
    return listMatching("#stage .filebox.bucket").flatMap(listBucketPaths);
}

test("test_unrelated_roots_render_zero_pair_widgets", async () => {
    // Scenario (task 238, spec S18): with no shared relative path, the stage draws no pair widget.
    await renderPageAgainstLiveEndpoint();
    // no pair widget is drawn — `:not(.bucket)` excludes the two orphan buckets, which are also .filebox elements.
    assert.equal(listMatching("#stage .filebox:not(.bucket)").length, 0);
    // and the empty-state message stands in for them.
    assert.equal(document.querySelector("#stage .nopairs")?.textContent, "No git ↔ on-disk pairs.");
});

test("test_unrelated_roots_render_exactly_the_two_orphan_buckets", async () => {
    // Scenario: with both directions non-empty, S18 draws BOTH buckets and omits neither.
    await renderPageAgainstLiveEndpoint();
    // exactly two buckets exist, and each is identified by title rather than by count alone.
    assert.equal(listMatching("#stage .filebox.bucket").length, 2);
    assert.notEqual(findBucketTitled("No on-disk match"), undefined);
    assert.notEqual(findBucketTitled("No repository match"), undefined);
});

test("test_every_repo_path_and_every_disk_path_lands_in_its_own_bucket", async () => {
    // Scenario (spec S18 "Output contract"): assert WHICH PATH is in WHICH bucket, because a swap keeps counts identical.
    await renderPageAgainstLiveEndpoint();
    // the repo's two tracked paths, repo-relative and oldest commit first (10:00 then 15:00).
    assert.deepEqual(listBucketPaths(findBucketTitled("No on-disk match")!), ["alpha.py", "docs/readme.md"]);
    // the folder's two files, oldest mtime first (09:00 then 12:00 the next day).
    assert.deepEqual(listBucketPaths(findBucketTitled("No repository match")!), ["notes.txt", "todo.md"]);
});

test("test_layer1_view_reports_no_orphan_for_a_submodules_contents", async () => {
    // Scenario: submodule files belong to another repository, so neither bucket mentions them.
    await renderPageAgainstLiveEndpoint(submoduleRoot, submoduleRoot);
    const bucketPaths = listEveryBucketPath();
    // the submodule's CONTENTS are absent — the walk never descended into the folder at all.
    for (const path of bucketPaths) {
        assert.equal(path?.startsWith(`${SUBMODULE_FIXTURE_FOLDER}/`), false, `${path} is submodule content`);
    }
    // and the gitlink is no phantom "No on-disk match" row: `git ls-tree -r` lists a bare directory name.
    assert.equal(bucketPaths.includes(SUBMODULE_FIXTURE_FOLDER), false);
    // the root's own tracked file still pairs, so the exclusion did not over-reach.
    assert.ok(listMatching("#stage .filebox:not(.bucket) .fname")
        .some((name) => name.textContent === "kept.txt"));
});
