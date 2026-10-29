// Task 232 (spec S18): findDiskRepoPairing joins disk paths to repo paths; paths only, bucket names pinned.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DiskFileState } from "../src/layer1_disk_walk.ts";
import { findDiskRepoPairing } from "../src/layer1_pairing.ts";
import { Path } from "../src/structures/domain.ts";

// One disk entry; the mtime is distinct per path and must survive the join.
function describeDiskFile(relativePath: string, minute: number): DiskFileState {
    return {
        relativePath: new Path(relativePath),
        mtime: new Date(`2026-07-25T10:${String(minute).padStart(2, "0")}:00.000Z`),
    };
}

// The relative-path text of whatever the buckets and pairs came back holding.
function listPairPaths(pairing: { pairs: DiskFileState[] }): string[] {
    return pairing.pairs.map((file) => file.relativePath.toString());
}

test("test_pairing_matches_on_the_full_relative_path_not_the_bare_name", () => {
    // Scenario: notes.txt pairs; src/app.ts and lib/app.ts share a basename but are NOT a pair (S18).
    const disk = [describeDiskFile("notes.txt", 1), describeDiskFile("src/app.ts", 2)];
    const repo = [new Path("notes.txt"), new Path("lib/app.ts")];
    const pairing = findDiskRepoPairing(disk, repo);
    assert.deepEqual(listPairPaths(pairing), ["notes.txt"]);
    // the same-name-different-path pair splits into ONE member of each bucket.
    assert.deepEqual(pairing.gitOrphans.map((path) => path.toString()), ["lib/app.ts"]);
    assert.deepEqual(pairing.diskOrphans.map((file) => file.relativePath.toString()), ["src/app.ts"]);
});

test("test_pairing_keeps_each_paired_files_own_mtime", () => {
    // Scenario: a pair carries the disk entry itself, mtime included, not just its path.
    const disk = [describeDiskFile("nested/deep/data.json", 7)];
    const pairing = findDiskRepoPairing(disk, [new Path("nested/deep/data.json")]);
    assert.equal(pairing.pairs.length, 1);
    assert.deepEqual(pairing.pairs[0]?.mtime, new Date("2026-07-25T10:07:00.000Z"));
});

test("test_an_unrelated_repo_yields_zero_pairs_and_two_full_buckets", () => {
    // Scenario (task-238 core): disk and repo share no path, so both orphan buckets fill and no pair exists.
    const disk = [describeDiskFile("photo.png", 1), describeDiskFile("docs/plan.md", 2)];
    const repo = [new Path("README.md"), new Path("src/main.rs")];
    const pairing = findDiskRepoPairing(disk, repo);
    assert.deepEqual(pairing.pairs, []);
    assert.deepEqual(pairing.gitOrphans.map((path) => path.toString()), ["README.md", "src/main.rs"]);
    assert.deepEqual(pairing.diskOrphans.map((file) => file.relativePath.toString()), ["photo.png", "docs/plan.md"]);
});

test("test_identical_trees_yield_pairs_and_no_buckets_at_all", () => {
    // Scenario: every path matches, so both buckets are empty and the renderer omits them (S18).
    const disk = [describeDiskFile("a.ts", 1), describeDiskFile("b/c.ts", 2)];
    const pairing = findDiskRepoPairing(disk, [new Path("a.ts"), new Path("b/c.ts")]);
    assert.deepEqual(listPairPaths(pairing), ["a.ts", "b/c.ts"]);
    assert.deepEqual(pairing.gitOrphans, []);
    assert.deepEqual(pairing.diskOrphans, []);
});
