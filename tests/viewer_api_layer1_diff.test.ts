// Task 305: GET /api/layer1-diff answers unified hunks between two revisions of ONE Layer 1 file.
//
// Driven through a recording ServerResponse stand-in (viewer_api_layer1_file.test.ts's pattern); refusals surface as throws.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleLayer1DiffRequest } from "../src/viewer_api_layer1_diff.ts";

const FIRST_TEXT = "shared line\nfirst only\n";
const SECOND_TEXT = "shared line\nsecond only\n";
const WORKING_TREE_TEXT = "shared line\nsecond only\nedited on disk\n";
const FIXTURE_FILE = "notes.txt";

// Fixed git identity so the fixture never depends on the machine's config.
function runGit(repoDir: string, command: string): string {
    return execSync(`git -c user.name=t -c user.email=t@t ${command}`, { cwd: repoDir, stdio: "pipe" }).toString();
}

// Two commits of one file, then a further on-disk edit — every side kind the route serves.
function makeTwoCommitRepo(): { repoDir: string; firstHash: string; secondHash: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-diff-repo-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, FIXTURE_FILE), FIRST_TEXT);
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m first");
    const firstHash = runGit(repoDir, "rev-parse HEAD").trim();
    writeFileSync(join(repoDir, FIXTURE_FILE), SECOND_TEXT);
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m second");
    const secondHash = runGit(repoDir, "rev-parse HEAD").trim();
    writeFileSync(join(repoDir, FIXTURE_FILE), WORKING_TREE_TEXT);
    return { repoDir, firstHash, secondHash };
}

// Drive the route the way the server does — a query string in, one { diff } out.
function requestLayer1Diff(parameters: Record<string, string>): { status: number; diff: string } {
    let status = 0;
    let body = "";
    const response = {
        writeHead: (code: number) => { status = code; },
        end: (text: string) => { body = text; },
    } as unknown as ServerResponse;
    handleLayer1DiffRequest(response, new URLSearchParams(parameters));
    return { status, diff: (JSON.parse(body) as { diff: string }).diff };
}

const { repoDir, firstHash, secondHash } = makeTwoCommitRepo();

test("test_layer1_diff_endpoint_diffs_two_commits_of_one_file", () => {
    const { status, diff } = requestLayer1Diff({ repo: repoDir, path: FIXTURE_FILE, baseHash: firstHash, targetHash: secondHash });
    assert.equal(status, 200);
    assert.ok(diff.startsWith("@@"), diff);
    assert.ok(diff.includes("-first only"), diff);
    assert.ok(diff.includes("+second only"), diff);
});

test("test_layer1_diff_endpoint_uses_the_working_tree_for_a_side_with_no_hash", () => {
    const { diff } = requestLayer1Diff({ repo: repoDir, dir: repoDir, path: FIXTURE_FILE, baseHash: secondHash });
    assert.ok(diff.includes("+edited on disk"), diff);
    assert.ok(!diff.includes("-second only"), diff);
});

test("test_layer1_diff_endpoint_answers_empty_for_identical_sides", () => {
    const { diff } = requestLayer1Diff({ repo: repoDir, path: FIXTURE_FILE, baseHash: firstHash, targetHash: firstHash });
    assert.equal(diff, "");
});

test("test_layer1_diff_endpoint_refuses_bad_hashes_and_escaping_paths", () => {
    assert.throws(
        () => requestLayer1Diff({ repo: repoDir, path: FIXTURE_FILE, baseHash: "HEAD; rm -rf /", targetHash: firstHash }),
        /not a commit hash/,
    );
    assert.throws(
        () => requestLayer1Diff({ dir: repoDir, path: "../../etc/passwd" }),
        /escapes the folder/,
    );
});
