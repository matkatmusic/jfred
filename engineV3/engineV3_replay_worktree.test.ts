import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { copyRepoIntoState, moveBranchesToCommitTime } from "./engineV3_replay_git.ts";
import { addWorktreeToState, findWorktreeAgentId } from "./engineV3_replay_worktree.ts";

const AGENT_TOOL_USE_ID = "toolu_01UVW3WJ1Ks7h36C1EYABJNC";
const AGENT_ID = "a7120163a3f6f7816";
const COMMIT_ISO_DATE = "2026-01-01T00:00:10Z";
const LAUNCHED_TEXT = `Async agent launched successfully. (This tool result is internal metadata - never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: ${AGENT_ID} (internal ID - do not mention to user. Use SendMessage with to: '${AGENT_ID}', summary: '<5-10 word recap>' to continue this agent.)\nThe agent is working in the background.`;
const BLOCKED_TEXT = "Permission for this action was denied by the Claude Code auto mode classifier.";

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeAgentCallLine(isolation: string | undefined): object {
    const input = { description: "Part 16 Add Question widget", subagent_type: "general-purpose", prompt: "You build ONE standalone part", isolation };
    const block = { type: "tool_use", id: AGENT_TOOL_USE_ID, name: "Agent", input, caller: { type: "direct" } };
    return { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
}

function makeAgentResultLine(resultText: string): object {
    const block = { type: "tool_result", tool_use_id: AGENT_TOOL_USE_ID, content: [{ type: "text", text: resultText }] };
    return { type: "user", uuid: "fb4f2aa6-3410-4aaa-85d8-a8675096b95c", parentUuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", timestamp: "2026-10-27T17:25:01.039Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "user", content: [block] } };
}

// Writes the lines to a JSONL file and loads them, so each line knows its source file.
function loadFixtureLines(t: TestContext, fixtureLines: object[]): JSONLLine[] {
    const jsonlFile = join(makeTempFolder(t, "engine-v3-worktree-jsonl-"), "session.jsonl");
    writeFileSync(jsonlFile, fixtureLines.map((fixtureLine) => JSON.stringify(fixtureLine)).join("\n") + "\n");
    return loadTranscript(jsonlFile).records;
}

function runGit(folder: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: COMMIT_ISO_DATE, GIT_AUTHOR_DATE: COMMIT_ISO_DATE };
    return execFileSync("git", gitArgs, { cwd: folder, encoding: "utf8", env }).trim();
}

// One commit on main, copied into a state folder whose branches and HEAD are moved to that commit.
function makeStateAtCommit(t: TestContext): { state: Path; commit: string } {
    const workFolder = makeTempFolder(t, "engine-v3-worktree-source-");
    runGit(workFolder, ["init", "-q", "-b", "main"]);
    writeFileSync(join(workFolder, "a.txt"), "a.txt");
    runGit(workFolder, ["add", "-A"]);
    runGit(workFolder, ["commit", "-q", "-m", "a.txt"]);
    const commit = runGit(workFolder, ["rev-parse", "HEAD"]);
    const state = new Path(makeTempFolder(t, "engine-v3-worktree-state-"));
    const repoPath = new Path(join(workFolder, ".git"));
    copyRepoIntoState(repoPath, state);
    moveBranchesToCommitTime(state, repoPath, new Uuid(commit));
    return { state, commit };
}

test("test_findWorktreeAgentId_reads_the_id_from_a_worktree_agent_result", (t) => {
    // Scenario: a worktree Agent call and its result text that names the agent.
    // the file has the Agent call with isolation worktree, then the launched result
    const lines = loadFixtureLines(t, [makeAgentCallLine("worktree"), makeAgentResultLine(LAUNCHED_TEXT)]);
    // ask for the worktree agent id of the result line
    const agentId = findWorktreeAgentId(lines[1] as JSONLLine);
    // it is the id in the `agentId:` line
    assert.equal(agentId?.toString(), AGENT_ID);
});

test("test_findWorktreeAgentId_returns_undefined_when_the_agent_call_has_no_worktree_isolation", (t) => {
    // Scenario: an Agent call with no isolation makes no worktree.
    // the file has an Agent call without isolation, then the launched result
    const lines = loadFixtureLines(t, [makeAgentCallLine(undefined), makeAgentResultLine(LAUNCHED_TEXT)]);
    // ask for the worktree agent id of the result line
    const agentId = findWorktreeAgentId(lines[1] as JSONLLine);
    // there is none
    assert.equal(agentId, undefined);
});

test("test_findWorktreeAgentId_returns_undefined_when_the_result_has_no_agentId_text", (t) => {
    // Scenario: a blocked worktree Agent call has no `agentId:` line.
    // the file has the Agent call with isolation worktree, then the blocked result
    const lines = loadFixtureLines(t, [makeAgentCallLine("worktree"), makeAgentResultLine(BLOCKED_TEXT)]);
    // ask for the worktree agent id of the result line
    const agentId = findWorktreeAgentId(lines[1] as JSONLLine);
    // there is none
    assert.equal(agentId, undefined);
});

test("test_findWorktreeAgentId_returns_undefined_for_an_api_request_blob_line", (t) => {
    // Scenario: an api-request-blob line repeats the `agentId:` text but makes no worktree.
    // the file has the Agent call with isolation worktree
    loadFixtureLines(t, [makeAgentCallLine("worktree")]);
    // the blob has a user line's shape, but its type is api-request-blob and it has no timestamp
    const blobFixture = { ...makeAgentResultLine(LAUNCHED_TEXT), type: "api-request-blob", timestamp: undefined };
    const blobLine = JSON.parse(JSON.stringify(blobFixture)) as JSONLLine;
    // ask for the worktree agent id of the blob line
    const agentId = findWorktreeAgentId(blobLine);
    // there is none
    assert.equal(agentId, undefined);
});

test("test_addWorktreeToState_makes_the_worktree_folder_and_branch_at_HEAD", (t) => {
    // Scenario: the worktree folder and its branch appear at HEAD's commit.
    // the state folder has a real .git moved to the commit
    const { state, commit } = makeStateAtCommit(t);
    // the file has the worktree Agent call and its launched result
    const lines = loadFixtureLines(t, [makeAgentCallLine("worktree"), makeAgentResultLine(LAUNCHED_TEXT)]);
    // add the worktree
    addWorktreeToState(state, lines[1] as JSONLLine);
    // the worktree folder exists
    assert.equal(existsSync(join(state.toString(), ".claude", "worktrees", `agent-${AGENT_ID}`)), true);
    // the branch points at the commit
    assert.equal(runGit(state.toString(), ["rev-parse", `refs/heads/worktree-agent-${AGENT_ID}`]), commit);
});

test("test_addWorktreeToState_starts_the_worktree_branch_at_the_origin_default_branch_when_origin_HEAD_is_set", (t) => {
    // Scenario: Claude Code makes an agent worktree from the remote default branch, not from the current commit.
    // the state folder has a real .git moved to the commit, and refs/remotes/origin/HEAD points at that commit
    const { state, commit } = makeStateAtCommit(t);
    runGit(state.toString(), ["update-ref", "refs/remotes/origin/main", commit]);
    runGit(state.toString(), ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    // HEAD moves one commit past origin
    runGit(state.toString(), ["commit", "-q", "--allow-empty", "-m", "second"]);
    // the file has the worktree Agent call and its launched result
    const lines = loadFixtureLines(t, [makeAgentCallLine("worktree"), makeAgentResultLine(LAUNCHED_TEXT)]);
    // add the worktree
    addWorktreeToState(state, lines[1] as JSONLLine);
    // the branch points at the origin commit, not at HEAD
    assert.equal(runGit(state.toString(), ["rev-parse", `refs/heads/worktree-agent-${AGENT_ID}`]), commit);
});
test("test_applyJSONLLineToState_adds_a_worktree_for_a_worktree_agent_result", (t) => {
    // Scenario: replaying the launched result line makes the worktree.
    // the state folder has a real .git moved to the commit
    const { state } = makeStateAtCommit(t);
    // the file has the worktree Agent call and its launched result
    const lines = loadFixtureLines(t, [makeAgentCallLine("worktree"), makeAgentResultLine(LAUNCHED_TEXT)]);
    // replay the result line
    applyJSONLLineToState(state, lines[1] as JSONLLine, [], { bashCallResults: new Map(), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") });
    // the worktree folder exists
    assert.equal(existsSync(join(state.toString(), ".claude", "worktrees", `agent-${AGENT_ID}`)), true);
});
