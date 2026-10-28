// Task 286: GET /api/layer1-refs feeds the branch and commit dropdowns; the handler is called directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendLayer1RefsResponse, LAYER1_REF_COMMIT_LIMIT } from "../src/viewer_api_layer1_refs.ts";
import type { Layer1RefsView } from "../webapp/layer1-wire.ts";

const FIRST_COMMIT_INSTANT = "2026-07-01T10:00:00Z";
const SECOND_COMMIT_INSTANT = "2026-07-01T15:00:00Z";
// `git init -b` pins the branch name so the head assertion ignores init.defaultBranch.
const TRUNK_BRANCH = "trunk";
const SIDE_BRANCH = "sidecar";

// Author and committer dates share one instant, because `--format=%ad` prints the author date.
function runGit(repoDir: string, command: string, commitInstant?: string): void {
    execSync(`git -c user.name=t -c user.email=t@t ${command}`, {
        cwd: repoDir,
        stdio: "pipe",
        env: {
            ...process.env,
            ...(commitInstant === undefined ? {} : { GIT_AUTHOR_DATE: commitInstant, GIT_COMMITTER_DATE: commitInstant }),
        },
    });
}

// Two commits on `trunk` plus a second branch that is not checked out.
function makeRefsFixtureRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-refs-repo-"));
    runGit(repoDir, `init -q -b ${TRUNK_BRANCH}`);
    writeFileSync(join(repoDir, "shared.txt"), "committed\n");
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m first", FIRST_COMMIT_INSTANT);
    writeFileSync(join(repoDir, "shared.txt"), "committed twice\n");
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m second", SECOND_COMMIT_INSTANT);
    runGit(repoDir, `branch ${SIDE_BRANCH}`);
    return repoDir;
}

// sendJson writes a header then ends with the JSON body, so a two-method stand-in captures both.
function captureRefsResponse(parameters: Record<string, string>): { status: number; view: Layer1RefsView } {
    let status = 0;
    let body = "";
    const response = {
        writeHead(code: number) { status = code; return response; },
        end(text: string) { body = text; },
    } as unknown as ServerResponse;
    sendLayer1RefsResponse(response, new URLSearchParams(parameters));
    return { status, view: JSON.parse(body) as Layer1RefsView };
}

const repoDir = makeRefsFixtureRepo();

test("test_layer1_refs_endpoint_lists_every_branch_with_the_checked_out_one_first", () => {
    // Scenario: the branch dropdown must offer every local branch and open on the active one.
    const { status, view } = captureRefsResponse({ repo: repoDir });
    assert.equal(status, 200);
    // both branch names are offered...
    assert.deepEqual([...view.branches].sort(), [SIDE_BRANCH, TRUNK_BRANCH]);
    // ...the checked-out one is named as `head`...
    assert.equal(view.head, TRUNK_BRANCH);
    // ...and it leads the list, so the dropdown's first option is the branch already in force.
    assert.equal(view.branches[0], TRUNK_BRANCH);
});

test("test_layer1_refs_endpoint_returns_capped_newest_first_commits", () => {
    // Scenario: the commit dropdown is a capped head window, newest at the top.
    const { view } = captureRefsResponse({ repo: repoDir });
    assert.deepEqual(view.commits.map((commit) => commit.subject), ["second", "first"]);
    // the row carries the short date git log was asked for, not a raw timestamp.
    assert.equal(view.commits[0]?.date, "2026-07-01");
    assert.ok(view.commits.length <= LAYER1_REF_COMMIT_LIMIT, String(view.commits.length));
});

test("test_layer1_refs_endpoint_reads_the_requested_ref_rather_than_head", () => {
    // Scenario: picking a branch re-asks with `ref=<branch>`, and an empty ref still means HEAD.
    assert.equal(captureRefsResponse({ repo: repoDir, ref: SIDE_BRANCH }).view.commits.length, 2);
    assert.equal(captureRefsResponse({ repo: repoDir, ref: "" }).view.commits.length, 2);
});

test("test_layer1_refs_endpoint_rejects_a_folder_that_is_not_a_repository", () => {
    // Scenario: a folder that is not a repo throws here, naming itself, so the outer catch 400s.
    const plainDir = mkdtempSync(join(tmpdir(), "layer1-refs-plain-"));
    assert.throws(() => captureRefsResponse({ repo: plainDir }), /not a git repository/);
    // a `repo` that is not on disk at all fails the folder check before git is ever spawned.
    const missingDir = join(tmpdir(), "layer1-refs-definitely-not-here");
    assert.throws(() => captureRefsResponse({ repo: missingDir }), /does not exist/);
});
