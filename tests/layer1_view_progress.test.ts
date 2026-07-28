// Step 3 of the S18 Layer 1 feedback fixes: buildLayer1View announces its position while it runs.  The route blocks for ~10 s against the real jfred repo — one `git log` per tracked path — and the page showed the PREVIOUS view's crumb the whole time, which read as frozen.
//
// Called IN-PROCESS rather than through a spawned viewer: the sink is a plain function parameter, so nothing here needs HTTP, a scratch port, or the NDJSON framing (tests/viewer_api_layer1_stream .test.ts owns that). The fixture is the shared one every other Layer 1 server test uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY,
    LAYER1_PROGRESS_LABEL_READING_HISTORY,
    LAYER1_PROGRESS_LABEL_READING_TREE,
    LAYER1_PROGRESS_LABEL_RESOLVING_RULER,
    LAYER1_PROGRESS_LABEL_WALKING_FOLDER,
    buildLayer1View,
} from "../src/viewer_api_layer1.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import { Path } from "../src/structures/domain.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary.ts";
import { makeFixtureDiskFolder, makeFixtureRepo } from "./layer1-view-test-helpers.ts";

// Build the shared fixture's view, recording every event the sink is handed.
function recordProgressWhileBuilding(): ProgressEvent[] {
    const events: ProgressEvent[] = [];
    buildLayer1View(
        new Path(makeFixtureDiskFolder()),
        new Path(makeFixtureRepo()),
        "HEAD",
        (event) => events.push(event),
    );
    return events;
}

// The events carrying a count — the ones a determinate bar can be drawn from.
function listCountedEventsLabelled(events: ProgressEvent[], label: string): ProgressEvent[] {
    return events.filter((event) => event.label === label && event.current !== undefined);
}

test("test_buildLayer1View_reports_a_counted_event_per_pair_history_read", () => {
    // Scenario: the endpoint blocks for ~10 s on one `git log` per tracked path, so it must announce its position so the page can draw a determinate bar.  Steps: build the view over the shared fixture with a recording sink.
    const events = recordProgressWhileBuilding();
    const counted = listCountedEventsLabelled(events, LAYER1_PROGRESS_LABEL_READING_HISTORY);
    // the fixture has exactly one pair (shared.txt), so exactly one counted history event fires.
    assert.equal(counted.length, 1);
    // the counted events run 1..N over the pairs, each carrying the same total...
    assert.deepEqual(counted.map((event) => event.current), [1]);
    assert.deepEqual(counted.map((event) => event.total), [1]);
    // ...and the last counted event's current equals its total, so the bar reaches full.
    const last = counted.at(-1)!;
    assert.equal(last.current, last.total);
});

test("test_buildLayer1View_reports_a_counted_event_per_repository_only_placement", () => {
    // Scenario: placing the repo-only bucket costs one `git log` per row too, so it is counted on its own rather than folded into the pair count — the two stages have different totals.  Steps: build the view over the shared fixture, whose repo holds one path absent from disk.
    const counted = listCountedEventsLabelled(recordProgressWhileBuilding(), LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY);
    // repo-only.txt is the single git orphan, so one counted event fires and it completes its total.
    assert.deepEqual(counted.map((event) => event.current), [1]);
    assert.deepEqual(counted.map((event) => event.total), [1]);
});

test("test_buildLayer1View_announces_every_countless_stage_in_execution_order", () => {
    // Scenario: the walk and the tree read happen BEFORE any counted work, and the ruler resolve after all of it, so a countless label keeps the bar moving through stages that have no N.  Steps: build the view and keep only the stages that carry no count.
    const events = recordProgressWhileBuilding();
    const countless = events.filter((event) => event.current === undefined).map((event) => event.label);
    // the three countless stages appear exactly once each, in the order the code runs them.
    assert.deepEqual(countless, [
        LAYER1_PROGRESS_LABEL_WALKING_FOLDER,
        LAYER1_PROGRESS_LABEL_READING_TREE,
        LAYER1_PROGRESS_LABEL_RESOLVING_RULER,
    ]);
    // every event rides the SHARED progress vocabulary rather than a second one invented here.
    assert.equal(events.every((event) => event.kind === DocumentResponseKind.progress), true);
});

test("test_buildLayer1View_needs_no_sink_at_all", () => {
    // Scenario: the sink is optional, so every pre-existing caller (and the plain non-streaming route) keeps compiling and running untouched.  Steps: build the view with three arguments, exactly as the plain route does.
    const view = buildLayer1View(new Path(makeFixtureDiskFolder()), new Path(makeFixtureRepo()), "HEAD");
    // the view is fully built — the default sink swallowed the events rather than throwing.
    assert.deepEqual(view.pairs.map((pair) => pair.path.toString()), ["shared.txt"]);
});
