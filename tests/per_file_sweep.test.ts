// Task 186 (spec S11): the sweep runner end to end on a one-file fixture — a git repo whose
// baseline commit seeds revision 0, a transcript that rewrote the file, and the working-tree
// bytes as the final endpoint. Also covers the resume path (a second run logs nothing new),
// which is what makes the 68-file task-187 run survive a kill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSweep } from "../scripts/per_file_sweep.ts";
import {
    SESSION_A,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

const BASELINE_CONTENT = "one\ntwo\n";
const REWRITTEN_CONTENT = "one\ntwo\nthree\n";
// The baseline commit must PRECEDE the transcript's records: the seed stage places its beacon by
// the commit's committer instant, and a commit stamped after every record seeds nothing.
const BASELINE_COMMIT_DATE = "2026-07-24T09:00:00Z";

// A git call in the fixture repo. The engine reads COMMITTER time (%cI, never author time), so
// the baseline date rides the environment — `git commit --date` moves only the author stamp.
function runGit(repoRoot: string, args: string[]): string {
    const env = {
        ...process.env,
        GIT_AUTHOR_DATE: BASELINE_COMMIT_DATE,
        GIT_COMMITTER_DATE: BASELINE_COMMIT_DATE,
    };
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", env }).trim();
}

// A git repo holding `sweep.py` at BASELINE_CONTENT, its working tree already rewritten, plus the
// baseline commit hash — the exact shape the sweep expects (candidate reported as M).
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

test("test_runSweep_reports_a_recovered_ladder_and_resumes_on_a_second_run", () => {
    // Scenario: one M candidate whose transcript wrote today's bytes — both endpoints match, so
    // the table's verdict is ok; re-running adds no rows.
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

    runSweep(argv);

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
    runSweep(argv);

    assert.equal(readFileSync(outPath, "utf8").trim().split("\n").length, 1);
});
