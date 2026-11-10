import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";
import { TERMINAL_EVENT, getNextEvent } from "./engineV3_replay_timeline.ts";

type ResetRepo = { repoFolder: string; commitA: string; commitB: string; commitC: string };

function runGitWithDate(repoFolder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: repoFolder, encoding: "utf8", env }).trim();
}

function commitFileWithDate(repoFolder: string, isoDate: string, name: string): string {
    writeFileSync(join(repoFolder, name), name);
    runGitWithDate(repoFolder, isoDate, ["add", "-A"]);
    runGitWithDate(repoFolder, isoDate, ["commit", "-q", "-m", name]);
    return runGitWithDate(repoFolder, isoDate, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// A at 10s, B at 20s, reset to A at 25s, C at 30s: B is named only by logs/HEAD.
function makeResetRepo(t: TestContext): ResetRepo {
    const repoFolder = makeTempFolder(t, "engine-v3-replay-repo-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    const commitA = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "a.txt");
    const commitB = commitFileWithDate(repoFolder, "2026-01-01T00:00:20Z", "b.txt");
    runGitWithDate(repoFolder, "2026-01-01T00:00:25Z", ["reset", "-q", "--hard", commitA]);
    const commitC = commitFileWithDate(repoFolder, "2026-01-01T00:00:30Z", "c.txt");
    return { repoFolder, commitA, commitB, commitC };
}

test("test_getNextEvent_includes_a_commit_that_only_the_HEAD_log_names_once", (t) => {
    // Scenario: B (20s) was reset away, so it is in logs/HEAD but not in the history from A to C.
    const resetRepo = makeResetRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    const line = JSON.stringify({ type: "user", uuid: "u-late", timestamp: "2026-01-01T00:01:40Z", toolUseResult: { note: "late" } });
    writeFileSync(join(jsonlFolder, "s1.jsonl"), line + "\n");
    const repoPath = new Path(join(resetRepo.repoFolder, ".git"));
    // collect the commit of every commit event, in order
    const commits: string[] = [];
    let lastEvent: TimelineEvent | null = null;
    while (true) {
        const event = getNextEvent(repoPath, [new Path(jsonlFolder)], lastEvent);
        if (event === TERMINAL_EVENT) {
            break;
        }
        if (event.type === TimelineEventKind.GitCommit) {
            commits.push(event.commit.toString());
        }
        lastEvent = event;
    }
    // the commits are A, B, C, each once, in time order
    assert.deepEqual(commits, [resetRepo.commitA, resetRepo.commitB, resetRepo.commitC]);
});
