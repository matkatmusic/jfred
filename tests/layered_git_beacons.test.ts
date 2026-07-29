// Task 200 (spec S3): collectCommitBeaconNodes — each commit touching a file contributes a verified beacon node carrying the commit's blob bytes at its COMMITTER instant (author time never used). Fixture is a real temp git repo; author dates deliberately differ from committer dates so a wrong time source fails loudly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary.ts";
import { collectCommitBeaconNodes, listCommitsTouchingFile } from "../src/layered_git_beacons.ts";

// Run a git command in `repoDir` with fixed identity and the given commit dates.
function runGit(repoDir: string, command: string, committerDate?: string, authorDate?: string): void {
    execSync(`git -c user.name=t -c user.email=t@t ${command}`, {
        cwd: repoDir,
        stdio: "pipe",
        env: {
            ...process.env,
            ...(committerDate === undefined ? {} : { GIT_COMMITTER_DATE: committerDate }),
            ...(authorDate === undefined ? {} : { GIT_AUTHOR_DATE: authorDate }),
        },
    });
}

// A repo with two commits touching notes.txt (author dates ≠ committer dates) and a third commit touching only other.txt.
function makeFixtureRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "layered-git-beacons-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, "notes.txt"), "first\n");
    runGit(repoDir, "add notes.txt");
    runGit(repoDir, 'commit -q -m one', "2026-07-01T10:00:00Z", "2026-06-01T08:00:00Z");
    writeFileSync(join(repoDir, "notes.txt"), "first\nsecond\n");
    runGit(repoDir, "add notes.txt");
    runGit(repoDir, 'commit -q -m two', "2026-07-02T11:00:00Z", "2026-06-02T09:00:00Z");
    writeFileSync(join(repoDir, "other.txt"), "unrelated\n");
    runGit(repoDir, "add other.txt");
    runGit(repoDir, 'commit -q -m three', "2026-07-03T12:00:00Z", "2026-06-03T10:00:00Z");
    return repoDir;
}

test("test_collectCommitBeaconNodes_yields_one_beacon_per_commit_touching_the_file", () => {
    // Scenario: only the two notes.txt commits contribute beacons, oldest first, each carrying that commit's blob bytes and no JSONL evidence (a commit blob has no line to point at).
    const repoDir = makeFixtureRepo();
    const beacons = collectCommitBeaconNodes(new Path(repoDir), new Path(join(repoDir, "notes.txt")));
    assert.equal(beacons.length, 2);
    assert.equal(beacons[0]!.kind, LayeredNodeKind.beacon);
    assert.equal(beacons[1]!.kind, LayeredNodeKind.beacon);
    assert.equal(beacons[0]!.content, "first\n");
    assert.equal(beacons[1]!.content, "first\nsecond\n");
    assert.equal(beacons[0]!.evidence, undefined);
    assert.equal(beacons[1]!.evidence, undefined);
});

test("test_collectCommitBeaconNodes_uses_committer_time_never_author_time", () => {
    // Scenario: the beacon instants equal the COMMITTER dates; the (earlier) author dates appear nowhere.
    const repoDir = makeFixtureRepo();
    const beacons = collectCommitBeaconNodes(new Path(repoDir), new Path(join(repoDir, "notes.txt")));
    assert.equal(beacons[0]!.instant.toISOString(), "2026-07-01T10:00:00.000Z");
    assert.equal(beacons[1]!.instant.toISOString(), "2026-07-02T11:00:00.000Z");
});

test("test_collectCommitBeaconNodes_returns_empty_outside_a_repo", () => {
    // Scenario: a directory with no .git yields no beacons — absence is a silent no-op, the same posture as reconstruction_git_evidence.ts.
    const bareDir = mkdtempSync(join(tmpdir(), "layered-git-beacons-norepo-"));
    const beacons = collectCommitBeaconNodes(new Path(bareDir), new Path(join(bareDir, "notes.txt")));
    assert.deepEqual(beacons, []);
});

test("test_collectCommitBeaconNodes_refuses_paths_outside_the_repo", () => {
    // Scenario: a file that does not live under repoPath yields no beacons.
    const repoDir = makeFixtureRepo();
    const beacons = collectCommitBeaconNodes(new Path(repoDir), new Path("/elsewhere/notes.txt"));
    assert.deepEqual(beacons, []);
});

// Task 235 (spec S18): /api/layer1-view accepts a `ref`, so the shared git-log reader must log from THAT ref. Without it, a repo tree read at a ref would be paired against ladders read from HEAD — a path tracked at the ref but absent from HEAD would come back with no commits at all.
test("test_commit_history_is_read_from_the_requested_ref_not_head", () => {
    // Scenario: side-only.txt exists ONLY on a side branch, so it is unreachable from HEAD.  Steps: build the three-commit fixture, then add side-only.txt on a branch and return to HEAD.
    const repoDir = makeFixtureRepo();
    // `git init`'s default branch name differs by machine, so return with `checkout -` rather than naming main/master.
    runGit(repoDir, "checkout -q -b side");
    writeFileSync(join(repoDir, "side-only.txt"), "side\n");
    runGit(repoDir, "add side-only.txt");
    runGit(repoDir, "commit -q -m side", "2026-07-04T13:00:00Z", "2026-06-04T11:00:00Z");
    runGit(repoDir, "checkout -q -");
    // reading with the DEFAULT ref finds nothing — the Layer-2 callers' behavior is unchanged.
    assert.deepEqual(listCommitsTouchingFile(new Path(repoDir), new Path("side-only.txt")), []);
    // reading with ref "side" finds that one commit — the ref reached git log.
    const sideTouches = listCommitsTouchingFile(new Path(repoDir), new Path("side-only.txt"), "side");
    assert.equal(sideTouches.length, 1);
    assert.equal(sideTouches[0]!.committerEpochSeconds, Date.parse("2026-07-04T13:00:00Z") / 1000);
});
