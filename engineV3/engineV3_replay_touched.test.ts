import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { applyCommitToState } from "./engineV3_replay_apply.ts";
import { clearTouchedPaths, listTouchedPaths } from "./engineV3_replay_touched.ts";

function runGitWithDate(folder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: folder, encoding: "utf8", env }).trim();
}

function commitAll(folder: string, isoDate: string, message: string): string {
    runGitWithDate(folder, isoDate, ["add", "-A"]);
    runGitWithDate(folder, isoDate, ["commit", "-q", "-m", message]);
    return runGitWithDate(folder, isoDate, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function writeFileIn(folder: string, name: string, content: string): void {
    const filePath = join(folder, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
}

test("test_applyCommitToState_records_written_and_removed_paths_as_touched", (t) => {
    // Scenario: commit 1 adds dir/a.txt and gone.txt, commit 2 removes gone.txt; both paths are touched.
    const repoFolder = makeTempFolder(t, "engine-v3-touched-repo-");
    const stateFolder = makeTempFolder(t, "engine-v3-touched-state-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    writeFileIn(repoFolder, "dir/a.txt", "a");
    writeFileIn(repoFolder, "gone.txt", "gone");
    const addCommit = commitAll(repoFolder, "2026-01-01T00:00:10Z", "add");
    runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["rm", "-q", "gone.txt"]);
    runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["commit", "-q", "-m", "remove"]);
    const removeCommit = runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["rev-parse", "HEAD"]);
    // start with no touched paths, then apply both commits
    clearTouchedPaths();
    applyCommitToState(new Uuid(addCommit), new Path(stateFolder), new Path(repoFolder));
    applyCommitToState(new Uuid(removeCommit), new Path(stateFolder), new Path(repoFolder));
    // the touched list holds both paths, relative to the state folder, sorted
    assert.deepEqual(listTouchedPaths(new Path(stateFolder)), ["dir/a.txt", "gone.txt"]);
});
