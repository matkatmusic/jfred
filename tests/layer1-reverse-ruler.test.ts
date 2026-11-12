// The reverse walk's ruler rows: one gutter row per state, aligned with the state's node.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireReverseKind, type WireReverseState } from "../webapp/layer1-wire-reverse.ts";
import { RULER_NODE_ROW_PIXELS } from "../webapp/layer1-components/ruler/layer1-ruler-axis.ts";
import { formatInstantLabel } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { listReverseRulerRows } from "../webapp/layer1-components/ruler/layer1-reverse-ruler.ts";

const EDIT_INSTANT = "2026-07-01T10:20:30.456Z";
const GAP_INSTANT = "2026-07-01T09:00:00.000Z";

function buildThreeStates(): WireReverseState[] {
    return [
        { index: 0, kind: WireReverseKind.DiskNow },
        { index: 1, kind: WireReverseKind.EditUndone, instant: EDIT_INSTANT },
        { index: 2, kind: WireReverseKind.UnknownChange, instant: GAP_INSTANT },
    ];
}

test("test_reverse_ruler_has_one_row_per_state", () => {
    // Build rows for three states.
    const rows = listReverseRulerRows(buildThreeStates());
    // There are three rows.
    assert.equal(rows.length, 3);
});

test("test_reverse_ruler_row_sits_at_the_same_pixel_offset_as_its_node", () => {
    // Build rows for three states.
    const rows = listReverseRulerRows(buildThreeStates());
    // Each row sits at index * node row pixels, the offset the node uses.
    assert.deepEqual(rows.map((row) => row.axisPx), [0, RULER_NODE_ROW_PIXELS, 2 * RULER_NODE_ROW_PIXELS]);
});

test("test_reverse_ruler_row_reads_the_formatted_instant", () => {
    // Build rows for three states.
    const rows = listReverseRulerRows(buildThreeStates());
    // A state with an instant reads the instant in the shared label format.
    assert.equal(rows[1]!.text, formatInstantLabel(EDIT_INSTANT));
    assert.equal(rows[2]!.text, formatInstantLabel(GAP_INSTANT));
});

test("test_reverse_ruler_row_of_the_disk_now_state_reads_now", () => {
    // Build rows for three states; the DiskNow state has no instant.
    const rows = listReverseRulerRows(buildThreeStates());
    // The DiskNow row reads "now".
    assert.equal(rows[0]!.text, "now");
});

test("test_reverse_ruler_keeps_two_states_with_the_same_instant_as_two_rows", () => {
    // Build rows for two states with the same instant.
    const rows = listReverseRulerRows([
        { index: 0, kind: WireReverseKind.EditUndone, instant: EDIT_INSTANT },
        { index: 1, kind: WireReverseKind.GitCommit, instant: EDIT_INSTANT },
    ]);
    // Both rows stay, each at its own offset.
    assert.deepEqual(rows.map((row) => row.axisPx), [0, RULER_NODE_ROW_PIXELS]);
});

test("test_reverse_ruler_row_stands_for_its_own_offset_and_instant_only", () => {
    // Build rows for three states.
    const rows = listReverseRulerRows(buildThreeStates());
    // A row with an instant lists that one offset and that one instant.
    assert.equal(rows[1]!.eventCount, 1);
    assert.deepEqual(rows[1]!.axisPxList, [RULER_NODE_ROW_PIXELS]);
    assert.deepEqual(rows[1]!.instants, [EDIT_INSTANT]);
    // The DiskNow row lists its offset and no instant.
    assert.deepEqual(rows[0]!.instants, []);
});

test("test_reverse_ruler_throws_for_a_state_that_is_not_disk_now_and_has_no_instant", () => {
    // A non-DiskNow state without an instant is a producer bug.
    assert.throws(() => listReverseRulerRows([{ index: 1, kind: WireReverseKind.EditUndone }]), /has no instant/);
});
