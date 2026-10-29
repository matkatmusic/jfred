// Script-run replay helpers used by git-evidence placement.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyScriptRunsOver,
    computeMidpointAfter,
    findFullContentIndices,
    findRunAtInstant,
    isFullContentEvent,
} from "../src/reconstruction_git_replay.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { FileEvent } from "../src/reconstruction_events.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const target = new Path("/tmp/repo/a.txt");
const emptyReader: BackupReader = () => "";

function buildWrite(content: string, timestamp: string): FileEvent {
    return { kind: EventKind.write, changeId: new Uuid("w"), target, content, timestamp: new Date(timestamp) };
}

test("test_isFullContentEvent_accepts_write_and_rejects_delete", () => {
    const write = buildWrite("a\n", "2026-01-01T00:00:00Z");
    const deletion = { kind: EventKind.delete, changeId: new Uuid("d"), target, timestamp: new Date() } as unknown as FileEvent;
    assert.equal(isFullContentEvent(write), true);
    assert.equal(isFullContentEvent(deletion), false);
});

test("test_findFullContentIndices_keeps_only_events_at_or_before_the_instant", () => {
    const events = [
        buildWrite("a\n", "2026-01-01T00:00:00Z"),
        buildWrite("b\n", "2026-01-01T00:10:00Z"),
        buildWrite("c\n", "2026-01-01T00:20:00Z"),
    ];
    assert.deepEqual(findFullContentIndices(events, new Date("2026-01-01T00:10:00Z")), [0, 1]);
});

test("test_findRunAtInstant_matches_by_timestamp", () => {
    const run = { code: "x", timestamp: new Date("2026-01-01T00:10:00Z") } as ScriptRun;
    const event = buildWrite("a\n", "2026-01-01T00:10:00Z");
    const other = buildWrite("a\n", "2026-01-01T00:11:00Z");
    assert.equal(findRunAtInstant([run], event), run);
    assert.equal(findRunAtInstant([run], other), undefined);
});

test("test_computeMidpointAfter_uses_successor_or_fallback", () => {
    const events = [buildWrite("a\n", "2026-01-01T00:00:00Z"), buildWrite("b\n", "2026-01-01T00:10:00Z")];
    assert.equal(computeMidpointAfter(events, 0, new Date("2026-01-01T01:00:00Z")).toISOString(), "2026-01-01T00:05:00.000Z");
    assert.equal(computeMidpointAfter(events, 1, new Date("2026-01-01T01:00:00Z")).toISOString(), "2026-01-01T00:35:00.000Z");
});

test("test_applyScriptRunsOver_returns_content_unchanged_for_no_indices_and_undefined_for_non_script", () => {
    const events = [buildWrite("a\n", "2026-01-01T00:00:00Z")];
    const unchanged = applyScriptRunsOver("a\n", [], events, [], target, [], emptyReader);
    assert.equal(unchanged!.final, "a\n");
    assert.equal(applyScriptRunsOver("a\n", [0], events, [], target, [], emptyReader), undefined);
});
