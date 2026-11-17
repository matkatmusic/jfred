// GET /api/layer1-inverse-state and /api/layer1-inverse-diff answer from the inverse repo of one file; they never build one.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { rmSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { join } from "node:path";
import { createInverseRepo, insertStatesIntoInverseRepo, type OrderedKnownState } from "../engineV3/engineV3_inverse_repo.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "../engineV3/engineV3_file_known_states.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { InverseDiffWire, InverseStateWire } from "../src/layer1_inverse_repos_wire.ts";
import { Path } from "../src/structures/domain.ts";
import { getInverseReposStoreFolder } from "../src/viewer_api_layer1_inverse_repos.ts";
import { sendLayer1InverseDiffResponse, sendLayer1InverseStateResponse } from "../src/viewer_api_layer1_inverse_state.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

const FILE_NAME = "a.txt";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function buildResponseStub(): { response: ServerResponse; body: () => string } {
    let body = "";
    const append = (chunk?: string): void => {
        body += chunk ?? "";
    };
    const response = { writeHead: () => response, write: append, end: append } as unknown as ServerResponse;
    return { response, body: () => body };
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeOrderedState(position: number, second: number | undefined, text: string | undefined): OrderedKnownState {
    let eventType = FileEventType.GitCommit;
    let instant: Date | undefined;
    if (second === undefined) {
        eventType = FileEventType.DiskNow;
    } else {
        instant = makeInstant(second);
    }
    const event = { type: eventType, instant, source: undefined, commitHash: undefined, bytes: text, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
    const state: FileKnownState = { event, moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, isFileAbsent: text === undefined, text };
    return { state, position };
}

// A temp project folder whose store folder holds the repo of a.txt: "one" from second 100, "two" from second 200, absent from second 300.
function makeProjectWithRepo(t: TestContext): Path {
    const projectFolder = new Path(createTempDir());
    const storeFolder = getInverseReposStoreFolder(projectFolder);
    t.after(() => rmSync(storeFolder.toString(), { recursive: true, force: true }));
    t.after(() => rmSync(projectFolder.toString(), { recursive: true, force: true }));
    const repoFolder = new Path(join(storeFolder.toString(), `${FILE_NAME}.git`));
    createInverseRepo(repoFolder, FILE_NAME, makeOrderedState(0, undefined, "now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [
        makeOrderedState(1, 300, undefined),
        makeOrderedState(2, 200, "line a\nline NEW\n"),
        makeOrderedState(3, 100, "line a\nline OLD\n"),
    ]);
    return projectFolder;
}

function buildQuery(projectFolder: Path, params: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ dir: projectFolder.toString(), file: FILE_NAME, ...params });
}

function getStateAnswer(query: URLSearchParams): InverseStateWire {
    const { response, body } = buildResponseStub();
    sendLayer1InverseStateResponse(response, query);
    return JSON.parse(body()) as InverseStateWire;
}

test("test_inverse_state_between_two_events_gives_the_older_commit_and_its_text", (t) => {
    // The file reads "OLD" from second 100 and "NEW" from second 200.
    const projectFolder = makeProjectWithRepo(t);
    // The state is asked for second 150, between the two.
    const answer = getStateAnswer(buildQuery(projectFolder, { at: makeInstant(150).toISOString() }));
    // The answer holds the second-100 commit and its text.
    assert.equal(answer.file, FILE_NAME);
    assert.equal(answer.commit!.instant, makeInstant(100).toISOString());
    assert.equal(answer.text, "line a\nline OLD\n");
});

test("test_inverse_state_before_the_oldest_state_gives_null_commit_and_null_text", (t) => {
    const projectFolder = makeProjectWithRepo(t);
    // The state is asked for second 50, older than the oldest state.
    const answer = getStateAnswer(buildQuery(projectFolder, { at: makeInstant(50).toISOString() }));
    assert.deepEqual(answer, { file: FILE_NAME, commit: null, text: null });
});

test("test_inverse_state_of_an_absent_file_gives_a_commit_marked_absent_and_null_text", (t) => {
    // The file is absent from second 300.
    const projectFolder = makeProjectWithRepo(t);
    const answer = getStateAnswer(buildQuery(projectFolder, { at: makeInstant(350).toISOString() }));
    assert.equal(answer.commit!.isFileAbsent, true);
    assert.equal(answer.text, null);
});

test("test_inverse_diff_holds_the_changed_line", (t) => {
    const projectFolder = makeProjectWithRepo(t);
    // The diff is asked from second 150 to second 250.
    const { response, body } = buildResponseStub();
    sendLayer1InverseDiffResponse(response, buildQuery(projectFolder, { from: makeInstant(150).toISOString(), to: makeInstant(250).toISOString() }));
    const answer = JSON.parse(body()) as InverseDiffWire;
    assert.equal(answer.file, FILE_NAME);
    assert.ok(answer.diff.includes("-line OLD\n"));
    assert.ok(answer.diff.includes("+line NEW\n"));
});

test("test_inverse_state_without_at_throws", (t) => {
    const projectFolder = makeProjectWithRepo(t);
    const { response } = buildResponseStub();
    assert.throws(() => sendLayer1InverseStateResponse(response, buildQuery(projectFolder, {})), /missing query param: at/);
});

test("test_inverse_state_with_an_invalid_time_throws", (t) => {
    const projectFolder = makeProjectWithRepo(t);
    const { response } = buildResponseStub();
    assert.throws(() => sendLayer1InverseStateResponse(response, buildQuery(projectFolder, { at: "not a time" })), /at is not a valid time/);
});

// Obsolete: files outside the project folder are no longer excluded, so getRelativePathInProject no longer throws.
// test("test_inverse_state_with_a_path_outside_the_project_throws", (t) => {
//     const projectFolder = makeProjectWithRepo(t);
//     const { response } = buildResponseStub();
//     const query = buildQuery(projectFolder, { file: "../escape.txt", at: makeInstant(150).toISOString() });
//     assert.throws(() => sendLayer1InverseStateResponse(response, query), /outside the project folder/);
// });

test("test_inverse_state_of_a_file_without_a_repo_names_the_file", (t) => {
    const projectFolder = makeProjectWithRepo(t);
    const { response } = buildResponseStub();
    const query = buildQuery(projectFolder, { file: "other.txt", at: makeInstant(150).toISOString() });
    assert.throws(() => sendLayer1InverseStateResponse(response, query), /other\.txt.*not built yet/);
});
