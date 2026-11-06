// Task 361 phase 2: the hidden jfred branch read into jfredCommits, directly and through the view route.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { listJfredBranchCommits } from "../src/viewer_api_layer1_jfred_read.ts";
import { Path } from "../src/structures/domain.ts";
import { JFRED_SUBJECT_PREFIX } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { buildViewUrl, createFixtureDiskFolder, launchFixtureViewer, SECOND_COMMIT_INSTANT } from "./layer1-view-test-helpers.ts";
import { createJfredBranchByPlainGit, createJfredTempRepo } from "./jfred-write-test-helpers.ts";

// Ports 17400 to 21900 (every 500) belong to other test files.
const SCRATCH_PORT = 22400 + (process.pid % 500);
const FIRST_MARK_INSTANT = "2026-07-01T16:00:00Z";
const SECOND_MARK_INSTANT = "2026-07-01T17:30:00Z";
const FIRST_MESSAGE = `${JFRED_SUBJECT_PREFIX}${FIRST_MARK_INSTANT}`;
const SECOND_MESSAGE = `${JFRED_SUBJECT_PREFIX}${SECOND_MARK_INSTANT}`;
// executeGitCommand pins every author date to this instant, so C2's author date differs from its committer date.
const PINNED_AUTHOR_INSTANT = "2020-01-01T00:00:00Z";

interface WireJfredCommitsView {
    jfredCommits: { base: { instant: string; shortHash: string } };
}

const diskDir = createFixtureDiskFolder();
const routeRepo = createJfredTempRepo();
createJfredBranchByPlainGit(routeRepo.repoDir, routeRepo.commitHashes[1]!, [FIRST_MESSAGE], [FIRST_MARK_INSTANT]);
let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await launchFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

test("test_listJfredBranchCommits_is_undefined_when_the_branch_is_absent", () => {
    // a temp repo has trunk commits and no jfred branch.
    const { repoDir } = createJfredTempRepo();
    // the read answers undefined.
    assert.equal(listJfredBranchCommits(new Path(repoDir)), undefined);
});

test("test_listJfredBranchCommits_finds_the_base_by_walking_first_parents_to_the_first_non_jfred_subject", () => {
    // two jfred commits sit on C2.
    const { repoDir, commitHashes } = createJfredTempRepo();
    createJfredBranchByPlainGit(repoDir, commitHashes[1]!, [FIRST_MESSAGE, SECOND_MESSAGE], [FIRST_MARK_INSTANT, SECOND_MARK_INSTANT]);
    // the base is C2's full hash.
    const branch = listJfredBranchCommits(new Path(repoDir))!;
    assert.equal(branch.baseHash, commitHashes[1]);
});

test("test_listJfredBranchCommits_lists_commits_oldest_first_with_author_date_short_hash_parent_and_message", () => {
    // two jfred commits sit on C2 with stated author dates.
    const { repoDir, commitHashes } = createJfredTempRepo();
    const jfredHashes = createJfredBranchByPlainGit(repoDir, commitHashes[1]!, [FIRST_MESSAGE, SECOND_MESSAGE], [FIRST_MARK_INSTANT, SECOND_MARK_INSTANT]);
    const commits = listJfredBranchCommits(new Path(repoDir))!.commits;
    // the list holds both commits, oldest first, with the stated author dates.
    assert.deepEqual(commits.map((commit) => commit.instant), [new Date(FIRST_MARK_INSTANT), new Date(SECOND_MARK_INSTANT)]);
    // each short hash is the first 8 characters of the commit hash.
    assert.deepEqual(commits.map((commit) => commit.shortHash), jfredHashes.map((hash) => hash.slice(0, 8)));
    // the first commit's parent is the base; the second commit's parent is the first.
    assert.equal(commits[0]!.parentShortHash, commitHashes[1]!.slice(0, 8));
    assert.equal(commits[1]!.parentShortHash, jfredHashes[0]!.slice(0, 8));
    // each message has no trailing newline.
    assert.deepEqual(commits.map((commit) => commit.message), [FIRST_MESSAGE, SECOND_MESSAGE]);
});

test("test_layer1_view_endpoint_places_the_jfred_base_by_committer_date_unless_author_time_is_chosen", async () => {
    // C2's committer date is its stated instant and its author date is the pinned 2020 instant.
    const baseShortHash = routeRepo.commitHashes[1]!.slice(0, 8);
    // the default view puts the base at C2's committer date.
    const committerResponse = await fetch(buildViewUrl(SCRATCH_PORT, { dir: diskDir, repo: routeRepo.repoDir }));
    assert.equal(committerResponse.status, 200);
    const committerView = await committerResponse.json() as WireJfredCommitsView;
    assert.equal(committerView.jfredCommits.base.shortHash, baseShortHash);
    assert.equal(committerView.jfredCommits.base.instant, new Date(SECOND_COMMIT_INSTANT).toISOString());
    // the view with time=author puts the base at C2's author date.
    const authorResponse = await fetch(buildViewUrl(SCRATCH_PORT, { dir: diskDir, repo: routeRepo.repoDir, time: "author" }));
    assert.equal(authorResponse.status, 200);
    const authorView = await authorResponse.json() as WireJfredCommitsView;
    assert.equal(authorView.jfredCommits.base.instant, new Date(PINNED_AUTHOR_INSTANT).toISOString());
});
