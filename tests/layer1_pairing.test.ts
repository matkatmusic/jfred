// Task 232 (spec S18): pairDiskFilesAgainstRepoPaths — the exact-relative-path join of the
// `current file state` against the `starting repository state`, and the two orphan buckets that
// fall out of it. Pure data in, pure data out: no temp folder and no temp repo are needed, which
// is the point — the join must not consult the filesystem or git for anything.
//
// PATHS ONLY, deliberately (user-settled 2026-07-25): these cases assert what gets extracted,
// matched and orphaned — never axisPx, timestamps or ruler data. Vertical placement is task 240's
// separate test. They also pin the property NAMES `pairs` / `gitOrphans` / `diskOrphans`, because
// the two orphan sets are mirror images and an inversion would be invisible to the task-238
// acceptance test, which only counts two buckets either way.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DiskFileState } from "../src/layer1_disk_walk.ts";
import { pairDiskFilesAgainstRepoPaths } from "../src/layer1_pairing.ts";
import { Path } from "../src/structures/domain.ts";

// One `current file state` entry. The mtime only has to be distinct per path here — pairing never
// reads it, it just has to survive the join so the on-disk node keeps its timestamp.
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
    // Scenario: notes.txt sits at the root of BOTH trees, so it pairs; src/app.ts is on disk but
    // the repo has lib/app.ts — same basename at a different path, which S18 says is NOT a pair.
    const disk = [describeDiskFile("notes.txt", 1), describeDiskFile("src/app.ts", 2)];
    const repo = [new Path("notes.txt"), new Path("lib/app.ts")];
    const pairing = pairDiskFilesAgainstRepoPaths(disk, repo);
    assert.deepEqual(listPairPaths(pairing), ["notes.txt"]);
    // the same-name-different-path pair splits into ONE member of each bucket.
    assert.deepEqual(pairing.gitOrphans.map((path) => path.toString()), ["lib/app.ts"]);
    assert.deepEqual(pairing.diskOrphans.map((file) => file.relativePath.toString()), ["src/app.ts"]);
});

test("test_pairing_keeps_each_paired_files_own_mtime", () => {
    // Scenario: a pair carries the disk entry itself, mtime included — the widget's on-disk node
    // is drawn at that instant, so the join must not flatten a pair down to its path.
    const disk = [describeDiskFile("nested/deep/data.json", 7)];
    const pairing = pairDiskFilesAgainstRepoPaths(disk, [new Path("nested/deep/data.json")]);
    assert.equal(pairing.pairs.length, 1);
    assert.deepEqual(pairing.pairs[0]?.mtime, new Date("2026-07-25T10:07:00.000Z"));
});

test("test_an_unrelated_repo_yields_zero_pairs_and_two_full_buckets", () => {
    // Scenario (the core of the task-238 acceptance test): the disk folder and the repo share no
    // path at all. Every disk file lands in "No repository match", every repo path in "No on-disk
    // match", and not one pair is invented.
    const disk = [describeDiskFile("photo.png", 1), describeDiskFile("docs/plan.md", 2)];
    const repo = [new Path("README.md"), new Path("src/main.rs")];
    const pairing = pairDiskFilesAgainstRepoPaths(disk, repo);
    assert.deepEqual(pairing.pairs, []);
    assert.deepEqual(pairing.gitOrphans.map((path) => path.toString()), ["README.md", "src/main.rs"]);
    assert.deepEqual(pairing.diskOrphans.map((file) => file.relativePath.toString()), ["photo.png", "docs/plan.md"]);
});

test("test_identical_trees_yield_pairs_and_no_buckets_at_all", () => {
    // Scenario: every path matches, so both buckets come back empty — which is how the renderer
    // learns to omit them (S18: buckets are omitted when empty).
    const disk = [describeDiskFile("a.ts", 1), describeDiskFile("b/c.ts", 2)];
    const pairing = pairDiskFilesAgainstRepoPaths(disk, [new Path("a.ts"), new Path("b/c.ts")]);
    assert.deepEqual(listPairPaths(pairing), ["a.ts", "b/c.ts"]);
    assert.deepEqual(pairing.gitOrphans, []);
    assert.deepEqual(pairing.diskOrphans, []);
});
