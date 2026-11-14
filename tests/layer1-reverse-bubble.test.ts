import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { WireReverseKind, type WireReverseState } from "../webapp/layer1-wire-reverse.ts";

initLayer1Dom();
const { buildReverseBubble } = await import("../webapp/layer1-components/bubbles/layer1-reverse-bubble.ts");

const EDIT_INSTANT = "2026-07-01T10:20:30.456Z";
const GAP_INSTANT = "2026-07-01T09:00:00.000Z";
const COMMIT_HASH = "80890a1b2c3d4e5f60718293a4b5c6d7e8f90123";

function buildThreeStates(): WireReverseState[] {
    return [
        { index: 0, kind: WireReverseKind.DiskNow },
        { index: 1, kind: WireReverseKind.EditUndone, instant: EDIT_INSTANT, content: "old", jsonlPath: "/s/a.jsonl", lineNumber: 7 },
        { index: 2, kind: WireReverseKind.UnknownChange, instant: GAP_INSTANT },
    ];
}

function listDots(bubble: HTMLElement): HTMLElement[] {
    return Array.from(bubble.querySelectorAll<HTMLElement>("i.node.n-rev"));
}

test("test_reverse_bubble_has_a_filebox_with_the_full_path_on_fname", () => {
    // Build a bubble for a nested path.
    const bubble = buildReverseBubble("src/deep/a.ts", buildThreeStates());
    // The outer box is a filebox that belongs to the reverseBubble component.
    assert.ok(bubble.classList.contains("filebox"));
    assert.equal(bubble.getAttribute("data-component"), "reverseBubble");
    // The name shows the file name only and carries the full path as identity.
    const fname = bubble.querySelector<HTMLElement>(".fname")!;
    assert.equal(fname.textContent, "a.ts");
    assert.equal(fname.getAttribute("data-path"), "src/deep/a.ts");
});

test("test_reverse_bubble_carries_the_class_the_minimap_scroll_room_rule_keys_on", () => {
    // Build a bubble.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // The filebox carries the reverse-bubble class (minimap.css gives the scroll area room below it).
    assert.ok(bubble.classList.contains("reverse-bubble"));
});

test("test_reverse_bubble_children_are_fname_then_sub_then_lane", () => {
    // Build a bubble.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // The filebox children are fname, sub, lane in that order.
    const childClasses = Array.from(bubble.children).map((child) => child.classList[0]);
    assert.deepEqual(childClasses, ["fname", "sub", "lane"]);
});

test("test_reverse_bubble_sub_counts_the_states", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // The sub line states the count and the order.
    assert.equal(bubble.querySelector(".sub")!.textContent, "3 states, newest first");
});

test("test_reverse_bubble_draws_one_dot_per_state_newest_first", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // The dots appear in state order, index 0 first.
    const indexes = listDots(bubble).map((dot) => dot.getAttribute("data-index"));
    assert.deepEqual(indexes, ["0", "1", "2"]);
});

test("test_reverse_bubble_label_follows_each_dot", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // Every dot is immediately followed by a label span.
    for (const dot of listDots(bubble)) {
        const label = dot.nextElementSibling!;
        assert.equal(label.tagName, "SPAN");
        assert.ok(label.classList.contains("nlabel"));
        assert.equal(label.previousElementSibling, dot);
    }
});

test("test_reverse_bubble_dot_carries_the_kind", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // Each dot names its kind.
    const kinds = listDots(bubble).map((dot) => dot.getAttribute("data-kind"));
    assert.deepEqual(kinds, ["DiskNow", "EditUndone", "UnknownChange"]);
});

test("test_reverse_bubble_dot_carries_instant_only_when_the_state_has_one", () => {
    // Build a bubble from three states; the DiskNow state has no instant.
    const dots = listDots(buildReverseBubble("a.ts", buildThreeStates()));
    // The DiskNow dot has no data-instant.
    assert.equal(dots[0]!.hasAttribute("data-instant"), false);
    // The other dots carry their instant.
    assert.equal(dots[1]!.getAttribute("data-instant"), EDIT_INSTANT);
    assert.equal(dots[2]!.getAttribute("data-instant"), GAP_INSTANT);
});

test("test_reverse_bubble_dot_carries_session_file_and_line_only_when_both_exist", () => {
    // Build a bubble from three states; only the EditUndone state has a jsonl path and line.
    const dots = listDots(buildReverseBubble("a.ts", buildThreeStates()));
    // The first and third dots have neither attribute.
    assert.equal(dots[0]!.hasAttribute("data-session-file"), false);
    assert.equal(dots[2]!.hasAttribute("data-line"), false);
    // The second dot has both.
    assert.equal(dots[1]!.getAttribute("data-session-file"), "/s/a.jsonl");
    assert.equal(dots[1]!.getAttribute("data-line"), "7");
});

test("test_reverse_bubble_dot_has_no_session_attributes_when_only_the_path_exists", () => {
    // Build a bubble from one state that has a jsonl path but no line number.
    const bubble = buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.EditUndone, instant: EDIT_INSTANT, jsonlPath: "/s/a.jsonl" }]);
    // The dot has neither attribute.
    const dot = listDots(bubble)[0]!;
    assert.equal(dot.hasAttribute("data-session-file"), false);
    assert.equal(dot.hasAttribute("data-line"), false);
});

test("test_reverse_bubble_places_each_dot_and_label_at_index_times_row_pixels", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // Each dot and its label sit at index * 22 px.
    const expectedAxisPx = ["0", "22", "44"];
    const dotAxisPx = listDots(bubble).map((dot) => dot.style.getPropertyValue("--axis-px"));
    const labelAxisPx = listDots(bubble).map((dot) => (dot.nextElementSibling as HTMLElement).style.getPropertyValue("--axis-px"));
    assert.deepEqual(dotAxisPx, expectedAxisPx);
    assert.deepEqual(labelAxisPx, expectedAxisPx);
});

test("test_reverse_bubble_lane_span_reaches_the_oldest_dot", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // The lane span equals the oldest dot's place.
    const lane = bubble.querySelector<HTMLElement>(".lane")!;
    assert.equal(lane.style.getPropertyValue("--span-px"), "44");
});

test("test_reverse_bubble_disk_now_label_reads_now_on_disk", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // The first label reads "now · on disk".
    const labels = Array.from(bubble.querySelectorAll(".nlabel")).map((label) => label.textContent);
    assert.equal(labels[0], "now · on disk");
});

test("test_reverse_bubble_label_joins_the_time_and_the_words", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // The other labels read "<time> · <words>"; the time is the ruler's millisecond label.
    const labels = Array.from(bubble.querySelectorAll(".nlabel")).map((label) => label.textContent);
    assert.equal(labels[1], "07-01 10:20:30.456 · before edit");
    assert.equal(labels[2], "07-01 09:00:00.000 · unknown change");
});

test("test_reverse_bubble_label_words_for_every_other_kind", () => {
    // Build a bubble with one state of each remaining kind.
    const bubble = buildReverseBubble("a.ts", [
        { index: 0, kind: WireReverseKind.WriteUndone, instant: EDIT_INSTANT },
        { index: 1, kind: WireReverseKind.FileCreated, instant: EDIT_INSTANT },
        { index: 2, kind: WireReverseKind.ScriptChange, instant: EDIT_INSTANT },
    ]);
    // Each label ends with its kind's words.
    const labels = Array.from(bubble.querySelectorAll(".nlabel")).map((label) => label.textContent);
    assert.equal(labels[0], "07-01 10:20:30.456 · before write");
    assert.equal(labels[1], "07-01 10:20:30.456 · file did not exist");
    assert.equal(labels[2], "07-01 10:20:30.456 · script change");
});

test("test_reverse_bubble_git_commit_label_reads_short_hash_then_time", () => {
    // Build a bubble with one GitCommit state that has a full 40-character hash.
    const bubble = buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.GitCommit, instant: EDIT_INSTANT, commitHash: COMMIT_HASH }]);
    // The label reads the first 7 characters of the hash, then the ruler's millisecond time.
    assert.equal(bubble.querySelector(".nlabel")!.textContent, "80890a1 · 07-01 10:20:30.456");
});

test("test_reverse_bubble_git_commit_dot_carries_the_full_hash", () => {
    // Build a bubble with one GitCommit state that has a full 40-character hash.
    const bubble = buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.GitCommit, instant: EDIT_INSTANT, commitHash: COMMIT_HASH }]);
    // The dot carries the full hash.
    assert.equal(listDots(bubble)[0]!.getAttribute("data-hash"), COMMIT_HASH);
});

test("test_reverse_bubble_backup_snapshot_label_reads_camera_time_then_snapshot", () => {
    // Build a bubble with one BackupSnapshot state.
    const bubble = buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.BackupSnapshot, instant: EDIT_INSTANT }]);
    // The label reads a camera, the ruler's millisecond time, then the word snapshot.
    assert.equal(bubble.querySelector(".nlabel")!.textContent, "📸 07-01 10:20:30.456 · snapshot");
});

test("test_reverse_bubble_dots_use_none_of_the_hidden_or_foreign_classes", () => {
    // Build a bubble from three states.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // No dot carries a class that other code hides or picks up.
    const foreignClasses = ["n-edit", "n-read", "n-commit", "n-disk", "n-snap", "n-script", "n-created"];
    for (const dot of listDots(bubble)) {
        for (const foreignClass of foreignClasses) {
            assert.equal(dot.classList.contains(foreignClass), false);
        }
    }
});

test("test_reverse_bubble_throws_for_a_non_disk_state_without_an_instant", () => {
    // Build a bubble from an EditUndone state that has no instant: this must fail loudly.
    assert.throws(() => buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.EditUndone }]));
});

test("test_reverse_bubble_throws_for_a_git_commit_state_without_a_commit_hash", () => {
    // Build a bubble from a GitCommit state that has an instant but no hash: this must fail loudly.
    assert.throws(() => buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.GitCommit, instant: EDIT_INSTANT }]));
});

test("test_reverse_bubble_read_only_label_says_read_no_change", () => {
    // Build a bubble from one ReadOnly state.
    const bubble = buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.ReadOnly, instant: EDIT_INSTANT }]);
    // The label reads "<time> · read, no change".
    assert.equal(bubble.querySelector(".nlabel")!.textContent, "07-01 10:20:30.456 · read, no change");
});

test("test_reverse_bubble_possible_change_label_says_bytes_not_known", () => {
    // Build a bubble from one PossibleChange state.
    const bubble = buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.PossibleChange, instant: EDIT_INSTANT }]);
    // The label reads "<time> · possible change, bytes not known".
    assert.equal(bubble.querySelector(".nlabel")!.textContent, "07-01 10:20:30.456 · possible change, bytes not known");
});

test("test_reverse_bubble_dot_says_modifying_false_when_the_state_is_not_modifying", () => {
    // Build a bubble from one state flagged as not modifying.
    const bubble = buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.ReadOnly, instant: EDIT_INSTANT, isModifying: false }]);
    // The dot says data-modifying false.
    assert.equal(listDots(bubble)[0]!.getAttribute("data-modifying"), "false");
});

test("test_reverse_bubble_dot_says_modifying_true_when_the_state_is_modifying", () => {
    // Build a bubble from one state flagged as modifying.
    const bubble = buildReverseBubble("a.ts", [{ index: 0, kind: WireReverseKind.EditUndone, instant: EDIT_INSTANT, isModifying: true }]);
    // The dot says data-modifying true.
    assert.equal(listDots(bubble)[0]!.getAttribute("data-modifying"), "true");
});

test("test_reverse_bubble_dot_counts_a_state_without_the_flag_as_modifying", () => {
    // Build a bubble from three states that carry no isModifying field.
    const bubble = buildReverseBubble("a.ts", buildThreeStates());
    // Every dot says data-modifying true.
    const flags = listDots(bubble).map((dot) => dot.getAttribute("data-modifying"));
    assert.deepEqual(flags, ["true", "true", "true"]);
});
