// buildLayer1View warms the session dots index under the loading bar, so the first scroll is fast.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayer1View } from "../src/viewer_api_layer1.ts";
import { LAYER1_PROGRESS_LABEL_INDEXING_SESSION_DOTS, getSessionDotIndex } from "../src/layer1_session_dots_index.ts";
import { encodeProjectFolderName } from "../src/reconstruction_repo_discovery.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { createFixtureDiskFolder, createFixtureRepo } from "./layer1-view-test-helpers.ts";
import { SESSION_ONE, writeSessionTranscript } from "./layer1-snapshot-wire-test-helpers.ts";

const DOT_INSTANT = "2026-07-01T16:00:00.000Z";

function writeProjectLog(diskDir: string): Path {
    const record = { type: RecordType.user, uuid: "a1000000-0000-0000-0000-000000000001", timestamp: DOT_INSTANT, sessionId: SESSION_ONE, message: { role: "user", content: "hi" } };
    return writeSessionTranscript(createTempDir(), SESSION_ONE, [record], encodeProjectFolderName(diskDir));
}

function recordProgressWhileBuilding(diskDir: string, sessionFiles: Path[]): ProgressEvent[] {
    const events: ProgressEvent[] = [];
    buildLayer1View(new Path(diskDir), new Path(createFixtureRepo()), "HEAD", (event) => events.push(event), undefined, sessionFiles);
    return events;
}

function listIndexingEvents(events: ProgressEvent[]): ProgressEvent[] {
    return events.filter((event) => event.label === LAYER1_PROGRESS_LABEL_INDEXING_SESSION_DOTS);
}

test("test_buildLayer1View_indexes_the_session_files_under_the_loading_bar", () => {
    // Scenario: building the view with one project log announces one counted indexing event.
    const diskDir = createFixtureDiskFolder();
    const logFile = writeProjectLog(diskDir);
    // build the view with the log as a session file, recording every progress event
    const events = recordProgressWhileBuilding(diskDir, [logFile]);
    // the sink got exactly one indexing event, counting 1 of 1
    const indexingEvents = listIndexingEvents(events);
    assert.deepEqual(indexingEvents.map((event) => event.current), [1]);
    assert.deepEqual(indexingEvents.map((event) => event.total), [1]);
    // asking for the index now finds the dots without a second indexing event (the merged index is cached)
    const laterEvents: ProgressEvent[] = [];
    const index = getSessionDotIndex(new Path(diskDir), [logFile], (event) => laterEvents.push(event));
    assert.equal(index.dots.length, 1);
    assert.equal(listIndexingEvents(laterEvents).length, 0);
});

test("test_buildLayer1View_without_session_files_emits_no_indexing_event", () => {
    // Scenario: a view built with no session files does not touch the dots index.
    const diskDir = createFixtureDiskFolder();
    // build the view with an empty session file list
    const events = recordProgressWhileBuilding(diskDir, []);
    // no event carries the indexing label
    assert.equal(listIndexingEvents(events).length, 0);
});
