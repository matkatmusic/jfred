// buildLayer1View announces its position while it runs; tested in-process through the sink parameter.

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
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { createFixtureDiskFolder, createFixtureRepo } from "./layer1-view-test-helpers.ts";

// Build the shared fixture's view, recording every event the sink is handed.
function recordProgressWhileBuilding(): ProgressEvent[] {
    const events: ProgressEvent[] = [];
    buildLayer1View(
        new Path(createFixtureDiskFolder()),
        new Path(createFixtureRepo()),
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
    // The slow endpoint announces its position so the page can draw a determinate bar.
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
    // The repo-only bucket is counted on its own: its total differs from the pair count.
    const counted = listCountedEventsLabelled(recordProgressWhileBuilding(), LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY);
    // repo-only.txt is the single git orphan, so one counted event fires and it completes its total.
    assert.deepEqual(counted.map((event) => event.current), [1]);
    assert.deepEqual(counted.map((event) => event.total), [1]);
});

test("test_buildLayer1View_announces_every_countless_stage_in_execution_order", () => {
    // Countless stages run before and after the counted work, keeping the bar moving.
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

test("test_buildLayer1View_reports_a_counted_event_per_resolved_ladder", () => {
    // Scenario (task 303): the ruler resolve was the silent stretch; each placed ladder now advances a counter.
    const counted = listCountedEventsLabelled(recordProgressWhileBuilding(), LAYER1_PROGRESS_LABEL_RESOLVING_RULER);
    assert.ok(counted.length >= 1);
    // the counter runs 1..N over the ladders and reaches its total.
    assert.deepEqual(counted.map((event) => event.current), counted.map((_, index) => index + 1));
    assert.equal(counted.at(-1)!.current, counted.at(-1)!.total);
});

test("test_buildLayer1View_needs_no_sink_at_all", () => {
    // The sink is optional, so the plain route's three-argument call still works.
    const view = buildLayer1View(new Path(createFixtureDiskFolder()), new Path(createFixtureRepo()), "HEAD");
    // the view is fully built — the default sink swallowed the events rather than throwing.
    assert.deepEqual(view.pairs.map((pair) => pair.path.toString()), ["shared.txt"]);
});
