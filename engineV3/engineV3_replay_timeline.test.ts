import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";
import { TERMINAL_EVENT, getNextEvent } from "./engineV3_replay_timeline.ts";

type TimedRepo = { repoFolder: string; commitA: string; commitB: string; commitC: string };

function runGitWithDate(repoFolder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: repoFolder, encoding: "utf8", env }).trim();
}

function commitFileWithDate(repoFolder: string, isoDate: string, name: string, content: string): string {
    writeFileSync(join(repoFolder, name), content);
    runGitWithDate(repoFolder, isoDate, ["add", "-A"]);
    runGitWithDate(repoFolder, isoDate, ["commit", "-q", "-m", name]);
    return runGitWithDate(repoFolder, isoDate, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// A at 10s, B at 20s adds added.txt, C at 30s changes change.txt.
function makeTimedRepo(t: TestContext): TimedRepo {
    const repoFolder = makeTempFolder(t, "engine-v3-replay-repo-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    const commitA = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "change.txt", "old");
    const commitB = commitFileWithDate(repoFolder, "2026-01-01T00:00:20Z", "added.txt", "added");
    const commitC = commitFileWithDate(repoFolder, "2026-01-01T00:00:30Z", "change.txt", "new");
    return { repoFolder, commitA, commitB, commitC };
}

function makeWriteCreateLine(repoFolder: string, fileName: string, content: string, secondsPastMidnight: number): string {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, secondsPastMidnight)).toISOString();
    const toolUseResult = { type: "create", filePath: join(repoFolder, fileName), content, structuredPatch: [], originalFile: null, userModified: false };
    return JSON.stringify({ type: "user", uuid: `u-${fileName}-${secondsPastMidnight}`, timestamp, toolUseResult });
}

function writeJSONLFile(folder: string, fileName: string, lines: string[]): void {
    writeFileSync(join(folder, fileName), lines.join("\n") + "\n");
}

function readEventKinds(repoFolder: string, jsonlFolder: string): TimelineEventKind[] {
    const kinds: TimelineEventKind[] = [];
    let lastEvent: TimelineEvent | null = null;
    while (true) {
        const event = getNextEvent(new Path(repoFolder), [new Path(jsonlFolder)], lastEvent);
        if (event === TERMINAL_EVENT) {
            return kinds;
        }
        kinds.push(event.type);
        lastEvent = event;
    }
}

test("test_getNextEvent_returns_the_first_commit_when_it_is_older_than_every_line", (t) => {
    // Scenario: commit A (10s) is older than the only line (15s), so it comes first.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    writeJSONLFile(jsonlFolder, "s1.jsonl", [makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15)]);
    // ask for the first event
    const event = getNextEvent(new Path(timedRepo.repoFolder), [new Path(jsonlFolder)], null);
    // it is commit A
    assert.notEqual(event, TERMINAL_EVENT);
    assert.equal((event as TimelineEvent).type, TimelineEventKind.GitCommit);
    assert.equal((event as { commit: Uuid }).commit.toString(), timedRepo.commitA);
});

test("test_getNextEvent_puts_a_line_in_the_same_second_before_the_commit", (t) => {
    // Scenario: a line at 20s and commit B at 20s share a second, so the line comes first.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    writeJSONLFile(jsonlFolder, "s1.jsonl", [makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 20)]);
    // list the kinds of all events in order
    const kinds = readEventKinds(timedRepo.repoFolder, jsonlFolder);
    // the line sits between commit A and commit B
    assert.deepEqual(kinds, [TimelineEventKind.GitCommit, TimelineEventKind.JSONLLine, TimelineEventKind.GitCommit, TimelineEventKind.GitCommit]);
});

test("test_getNextEvent_keeps_a_line_with_no_time_next_to_the_timed_line_after_it", (t) => {
    // Scenario: line 1 has no time and line 2 is at 15s, so both run after commit A (10s).
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    const timelessLine = JSON.stringify({ type: "user", uuid: "u-timeless", toolUseResult: { note: "no time" } });
    writeJSONLFile(jsonlFolder, "s1.jsonl", [timelessLine, makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15)]);
    // list the kinds of all events in order
    const kinds = readEventKinds(timedRepo.repoFolder, jsonlFolder);
    // commit A, then line 1 and line 2 together, then commits B and C
    assert.deepEqual(kinds, [TimelineEventKind.GitCommit, TimelineEventKind.JSONLLine, TimelineEventKind.JSONLLine, TimelineEventKind.GitCommit, TimelineEventKind.GitCommit]);
});

test("test_getNextEvent_returns_TERMINAL_EVENT_after_the_last_event", (t) => {
    // Scenario: after commit C, the last event, the next event is TERMINAL_EVENT.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    writeJSONLFile(jsonlFolder, "s1.jsonl", [makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15)]);
    const repoPath = new Path(timedRepo.repoFolder);
    const jsonlsPaths = [new Path(jsonlFolder)];
    // walk to the last event
    let lastEvent: TimelineEvent | null = null;
    while (true) {
        const event = getNextEvent(repoPath, jsonlsPaths, lastEvent);
        if (event === TERMINAL_EVENT) {
            break;
        }
        lastEvent = event;
    }
    // the last event is commit C
    assert.equal((lastEvent as { commit: Uuid }).commit.toString(), timedRepo.commitC);
    // asking again after it gives TERMINAL_EVENT
    assert.equal(getNextEvent(repoPath, jsonlsPaths, lastEvent), TERMINAL_EVENT);
});
