import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";
import { formatEventText } from "./engineV3_replay.ts";
import { PlateEventName } from "./engineV3_replay_plate.ts";
import { getNextEvent } from "./engineV3_replay_timeline.ts";

type TimedRepo = { repoFolder: string; commitA: string };

function runGitWithDate(repoFolder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: repoFolder, encoding: "utf8", env }).trim();
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// One commit A at 10s.
function makeTimedRepo(t: TestContext): TimedRepo {
    const repoFolder = makeTempFolder(t, "engine-v3-replay-repo-");
    runGitWithDate(repoFolder, "2026-10-27T00:00:10Z", ["init", "-q"]);
    writeFileSync(join(repoFolder, "change.txt"), "old");
    runGitWithDate(repoFolder, "2026-10-27T00:00:10Z", ["add", "-A"]);
    runGitWithDate(repoFolder, "2026-10-27T00:00:10Z", ["commit", "-q", "-m", "change.txt"]);
    const commitA = runGitWithDate(repoFolder, "2026-10-27T00:00:10Z", ["rev-parse", "HEAD"]);
    return { repoFolder, commitA };
}

function makeWriteCreateLine(repoFolder: string, fileName: string, content: string, secondsPastMidnight: number): string {
    const timestamp = new Date(Date.UTC(2026, 9, 27, 0, 0, secondsPastMidnight)).toISOString();
    const toolUseResult = { type: "create", filePath: join(repoFolder, fileName), content, structuredPatch: [], originalFile: null, userModified: false };
    return JSON.stringify({ type: "user", uuid: `u-${fileName}-${secondsPastMidnight}`, timestamp, toolUseResult });
}

// Commit events are turned off: the old commit-event test is kept here, commented out.
// test("test_formatEventText_names_the_repo_and_full_hash_for_a_commit", (t) => {
//     const timedRepo = makeTimedRepo(t);
//     const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
//     writeFileSync(join(jsonlFolder, "s1.jsonl"), makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15) + "\n");
//     const repoPath = new Path(join(timedRepo.repoFolder, ".git"));
//     const event = getNextEvent(repoPath, [new Path(jsonlFolder)], null) as TimelineEvent;
//     assert.equal(formatEventText(event, repoPath), `next event: source:${join(timedRepo.repoFolder, ".git")} commit:${timedRepo.commitA}`);
// });

test("test_formatEventText_names_the_kind_new_commit_and_message_for_an_outside_git_row", (t) => {
    // Scenario: the first event is the outside row of commit A, so the text names its kind, new commit and message.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    writeFileSync(join(jsonlFolder, "s1.jsonl"), makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15) + "\n");
    const repoPath = new Path(join(timedRepo.repoFolder, ".git"));
    const event = getNextEvent(repoPath, [new Path(jsonlFolder)], null) as TimelineEvent;
    // format the outside git event
    assert.equal(formatEventText(event, repoPath), `next event: outside git: Commit ${timedRepo.commitA} commit (initial): change.txt`);
});

test("test_formatEventText_names_the_jsonl_file_and_line_number_for_a_line", (t) => {
    // Scenario: the second event is the line at 15s, so the text names its file and line number.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    writeFileSync(join(jsonlFolder, "s1.jsonl"), makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15) + "\n");
    const repoPath = new Path(join(timedRepo.repoFolder, ".git"));
    const jsonlsPaths = [new Path(jsonlFolder)];
    // step past the row of commit A to the line
    const commitEvent = getNextEvent(repoPath, jsonlsPaths, null) as TimelineEvent;
    const lineEvent = getNextEvent(repoPath, jsonlsPaths, commitEvent) as TimelineEvent;
    // format the line event
    assert.equal(formatEventText(lineEvent, repoPath), `next event: source:${join(jsonlFolder, "s1.jsonl")} line:1`);
});

test("test_formatEventText_prints_the_capture_file_name_event_name_and_cwd_of_a_plate_capture", () => {
    const capture = { captureFile: new Path("/m/.plate/captures/1_2.json"), eventName: PlateEventName.SubagentStop, cwd: new Path("/m/proj"), sessionId: new Uuid("s"), transcriptPath: new Path("/t.jsonl"), toolCalls: [], agentTranscriptPath: undefined, timeMs: 0 };
    const event: TimelineEvent = { type: TimelineEventKind.PlateCapture, capture, timestamp: 0 };
    assert.equal(formatEventText(event, new Path("/r")), "next event: plate capture: 1_2.json SubagentStop /m/proj");
});
