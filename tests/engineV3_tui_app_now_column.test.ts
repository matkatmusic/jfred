// The [now] column of the Marker Box can be selected again after the marker leaves it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { ProjectEventEntry } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { LEFT_ARROW, RIGHT_ARROW, startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";
import { makeInstant } from "./engineV3_step_test_projects.ts";

test("test_left_arrow_from_the_newest_event_of_a_file_selects_the_now_column", async (t) => {
    // Scenario: the file has 2 events (seconds 10 and 20); another file has a newer event (second 30), so Now is second 30.
    const project = writeLongProject(t, true);
    const events: ProjectEventEntry[] = [
        { instant: makeInstant(30), file: new Path("/other/file.txt"), eventType: FileEventType.EditRow, source: "toolu_c" },
        { instant: makeInstant(20), file: project.file, eventType: FileEventType.EditRow, source: "toolu_b" },
        { instant: makeInstant(10), file: project.file, eventType: FileEventType.EditRow, source: "toolu_a" },
    ];
    const screen = await startScreen(t, project, { events });
    // at the start the file is at Now: [now] is selected.
    assert.ok(screen.frame().includes("[now]"));
    // right arrow twice: the file is at its earliest event; [now] is not selected.
    await screen.press(RIGHT_ARROW);
    await screen.press(RIGHT_ARROW);
    assert.ok(!screen.frame().includes("[now]"));
    // left arrow once: the file is at its newest event; [now] is still not selected.
    await screen.press(LEFT_ARROW);
    assert.ok(!screen.frame().includes("[now]"));
    // left arrow again: the marker moves onto the now column.
    await screen.press(LEFT_ARROW);
    assert.ok(screen.frame().includes("[now]"), screen.frame());
});
