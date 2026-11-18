process.env.FORCE_COLOR = "1";
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { createElement } from "react";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, JumpSpeed, TuiCommand } from "../src/structures/vocabulary.ts";
import { loadKeymap } from "../engineV3/tui/engineV3_tui_keymap.ts";

// Dynamic imports: chalk reads FORCE_COLOR when it loads, so Ink must load after the line above.
const { render } = await import("ink-testing-library");
const { DetailsBox, KeyFooter, buildKeyFooterEntries, layoutEntriesIntoLines } = await import("../engineV3/tui/engineV3_tui_footer.tsx");
const { buildInfoEntries } = await import("../engineV3/tui/engineV3_tui_info_row.tsx");

const KEYMAP_FILE = new Path(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"));
const CYAN_START = "\x1b[36m";
const GREEN_START = "\x1b[32m";

test("test_entries_that_fit_share_one_line", () => {
    // Scenario: two short entries fit in a line of 40 columns.
    // layout two entries.
    const lines = layoutEntriesIntoLines([{ label: "s", value: "select" }, { label: "d", value: "day" }], 40);
    // one line holds both.
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.length, 2);
});

test("test_entries_that_do_not_fit_wrap_to_the_next_line", () => {
    // Scenario: an entry "s: select" is 9 columns; two entries and the 2 column gap are 20 columns; a line of 15 columns holds only one.
    // layout two entries into 15 columns.
    const lines = layoutEntriesIntoLines([{ label: "s", value: "select" }, { label: "d", value: "daytime" }], 15);
    // two lines hold one entry each.
    assert.deepEqual(lines.map((line) => line.length), [1, 1]);
});

test("test_the_key_footer_entries_have_one_entry_per_command_and_the_speed_last", () => {
    // Scenario: the footer entries come from the keymap file.
    const keymap = loadKeymap(KEYMAP_FILE);
    // build the entries.
    const entries = buildKeyFooterEntries(keymap, JumpSpeed.Day);
    // one entry per command plus the speed entry.
    assert.equal(entries.length, Object.values(TuiCommand).length + 1);
    // the toggle selection entry reads "s: (de)select".
    assert.ok(entries.some((entry) => entry.label === "s" && entry.value === "(de)select"));
    // the last entry shows the speed.
    assert.deepEqual(entries[entries.length - 1], { label: "speed", value: "day" });
});

test("test_the_key_footer_draws_a_rounded_box_with_the_key_and_action_text", () => {
    // Scenario: the footer is drawn with rounded border characters, not ASCII dashes.
    const entries = buildKeyFooterEntries(loadKeymap(KEYMAP_FILE), JumpSpeed.Event);
    // render the footer in 100 columns.
    const { lastFrame, unmount } = render(createElement(KeyFooter, { entries, columns: 100 }));
    const frame = lastFrame() ?? "";
    unmount();
    // the frame has rounded corners and the text "s: (de)select".
    assert.ok(frame.includes("╭"), frame);
    assert.ok(frame.includes("╰"), frame);
    assert.ok(frame.replace(/\x1b\[[0-9;]*m/g, "").includes("s: (de)select"), frame);
});

test("test_the_details_box_colours_the_label_and_the_value_differently", () => {
    // Scenario: the label is cyan and the value is green, so the two can be told apart.
    // render the details box with one entry.
    const { lastFrame, unmount } = render(createElement(DetailsBox, { entries: [{ label: "commits", value: "7" }], columns: 100 }));
    const frame = lastFrame() ?? "";
    unmount();
    // the label has the cyan code before it, and the value has the green code before it.
    assert.ok(frame.includes(`${CYAN_START}commits`), JSON.stringify(frame));
    assert.ok(frame.includes(`${GREEN_START}7`), JSON.stringify(frame));
});

test("test_the_info_entries_give_a_label_and_a_value_for_each_fact", () => {
    // Scenario: a crashed file with a reason, an own time and no history walk.
    // build the entries for the input.
    const entries = buildInfoEntries({
        fileName: "a.txt",
        barInfo: { commitCount: 3, modifyingEventCount: 4, snapshotCount: 5, scriptCount: 6, failedReplayCount: 1, stateText: "ok", errorText: undefined },
        runState: { status: FileWalkStatus.Crashed, reasonText: "boom", failedReplayCount: 0 },
        ownTime: new Date("2026-01-02T03:04:05.000Z"),
        isTimeSpanned: false,
        scriptRefusalText: undefined,
    });
    // each fact is a label and a value.
    assert.deepEqual(entries.find((entry) => entry.label === "file"), { label: "file", value: "a.txt" });
    assert.deepEqual(entries.find((entry) => entry.label === "reason"), { label: "reason", value: "boom" });
    assert.deepEqual(entries.find((entry) => entry.label === "own time"), { label: "own time", value: "2026-01-02T03:04:05.000Z" });
    assert.deepEqual(entries.find((entry) => entry.label === "walk"), { label: "walk", value: "not walked to this time" });
    assert.deepEqual(entries.find((entry) => entry.label === "commits"), { label: "commits", value: "3" });
    assert.deepEqual(entries.find((entry) => entry.label === "failed replays"), { label: "failed replays", value: "1" });
});
