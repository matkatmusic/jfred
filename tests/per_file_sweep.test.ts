// Task 186 (S11): the sweep runner end to end on a one-file fixture, including resume.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeSweep } from "../scripts/per_file_sweep.ts";
import {
    SESSION_A,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

const BASELINE_CONTENT = "one\ntwo\n";
const REWRITTEN_CONTENT = "one\ntwo\nthree\n";
// The baseline commit must precede the transcript records, or the seed stage seeds nothing.
const BASELINE_COMMIT_DATE = "2026-07-24T09:00:00Z";

// A git call in the fixture repo; the engine reads committer time, so the date rides the environment.
function runGit(repoRoot: string, args: string[]): string {
    const env = {
        ...process.env,
        GIT_AUTHOR_DATE: BASELINE_COMMIT_DATE,
        GIT_COMMITTER_DATE: BASELINE_COMMIT_DATE,
    };
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", env }).trim();
}

// A git repo with `sweep.py` committed at baseline and rewritten on disk; returns the baseline hash.
function makeBaselineRepo(repoRoot: string): string {
    mkdirSync(repoRoot, { recursive: true });
    const git = (args: string[]): string => runGit(repoRoot, args);
    git(["init", "--quiet"]);
    git(["config", "user.email", "sweep@example.test"]);
    git(["config", "user.name", "Sweep Fixture"]);
    writeFileSync(join(repoRoot, "sweep.py"), BASELINE_CONTENT);
    git(["add", "sweep.py"]);
    git([
        "-c", `user.date=${BASELINE_COMMIT_DATE}`,
        "commit", "--quiet", "--date", BASELINE_COMMIT_DATE, "-m", "baseline",
    ]);
    const baseline = git(["rev-parse", "HEAD"]);
    writeFileSync(join(repoRoot, "sweep.py"), REWRITTEN_CONTENT);
    return baseline;
}

test("test_executeSweep_reports_a_recovered_ladder_and_resumes_on_a_second_run", () => {
    // Scenario: one M candidate with both endpoints matching gives verdict ok; a rerun adds no rows.
    const tree = makeSourceTree("-per-file-sweep");
    const repoRoot = join(tree.treeRoot, "repo");
    const baselineCommit = makeBaselineRepo(repoRoot);
    const fileHistoryRoot = join(tree.treeRoot, "file-history");
    mkdirSync(fileHistoryRoot, { recursive: true });
    const rewrite = buildWriteRecordPair(
        {
            sessionId: SESSION_A,
            cwd: repoRoot,
            timestamp: "2026-07-24T10:01:00.000Z",
            toolId: "toolu_sweep_w1",
            parentUuid: "prompt-1",
        },
        join(repoRoot, "sweep.py"),
        REWRITTEN_CONTENT,
    );
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [
        buildPromptRecord("prompt-1", null, "2026-07-24T10:00:00.000Z", repoRoot),
        ...rewrite.records,
    ]);
    const outPath = join(tree.treeRoot, "rows.jsonl");
    const tablePath = join(tree.treeRoot, "table.md");
    const argv = [
        "--repo", repoRoot,
        "--base-commit", baselineCommit,
        "--projects", tree.projectDir,
        "--fhsLoc", fileHistoryRoot,
        "--status", "M",
        "--out", outPath,
        "--table", tablePath,
    ];

    executeSweep(argv);

    const rows = readFileSync(outPath, "utf8").trim().split("\n");
    assert.equal(rows.length, 1);
    const row = JSON.parse(rows[0]!) as { file: string; revisions: number; baselineBlobMatched: boolean; diskMatched: boolean; unrecoverable: number };
    assert.equal(row.file, "sweep.py");
    assert.ok(row.revisions >= 2, `expected the git seed plus the write, got ${row.revisions}`);
    assert.equal(row.baselineBlobMatched, true, `row: ${rows[0]}`);
    assert.equal(row.diskMatched, true, `row: ${rows[0]}`);
    assert.equal(row.unrecoverable, 0, `row: ${rows[0]}`);
    const table = readFileSync(tablePath, "utf8");
    assert.match(table, /\| `sweep\.py` \|/);
    assert.match(table, /\| ok \|/);

    // Resume: the candidate is already logged, so the second run appends nothing.
    executeSweep(argv);

    assert.equal(readFileSync(outPath, "utf8").trim().split("\n").length, 1);
});
