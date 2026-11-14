// Task 907: the dot-instants answer is sent as deltas; decode and encode must agree, and the demo builds the same data from annotations.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionDotInstants, encodeSessionDotInstants, listSessionDotInstantsFromAnnotations } from "../webapp/layer1-components/session-column/layer1-wire-session-instants.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireAnnotation } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { SessionDotInstants } from "../webapp/layer1-components/ruler/layer1-session-dot-counts.ts";

function buildRecord(id: string, instant: string, sessionId: string): WireAnnotation {
    return { id, kind: WireRecordKind.user, instant, label: id, sessionId, sessionTitle: sessionId, sessionFile: `/x/${sessionId}.jsonl`, line: 1 };
}

test("test_decode_restores_the_ascending_instants_from_the_deltas", () => {
    // Scenario: the first delta is the absolute ms; each later delta is a step from the one before.
    // Step 1: decode one session whose deltas are 100, 5, 0, 20.
    const decoded = decodeSessionDotInstants({ sessions: [{ sessionId: "a", deltasMs: [100, 5, 0, 20] }] });
    // Step 2: the instants are the running sums, and the zero step repeats an instant.
    assert.deepEqual(decoded.get("a"), [100, 105, 105, 125]);
});

test("test_encode_then_decode_returns_the_same_instants", () => {
    // Scenario: a round trip keeps every session's list, equal instants included.
    // Step 1: build instants for two sessions, one with two dots at the same ms.
    const original: SessionDotInstants = new Map([
        ["a", [1000, 1000, 1500]],
        ["b", [7]],
    ]);
    // Step 2: encode, then decode.
    const decoded = decodeSessionDotInstants(encodeSessionDotInstants(original));
    // Step 3: the result equals the original.
    assert.deepEqual(decoded, original);
});

test("test_instants_from_annotations_are_ascending_per_session", () => {
    // Scenario: unsorted annotations of two sessions give two ascending lists, equal instants kept.
    // Step 1: build annotations out of order, across two sessions, with a repeated instant in session a.
    const annotations = [
        buildRecord("a3", "2026-06-01T10:30:00Z", "a"),
        buildRecord("b1", "2026-06-01T09:00:00Z", "b"),
        buildRecord("a1", "2026-06-01T10:00:00Z", "a"),
        buildRecord("a2", "2026-06-01T10:00:00Z", "a"),
    ];
    // Step 2: list the instants per session.
    const instants = listSessionDotInstantsFromAnnotations(annotations);
    // Step 3: each session's list is ascending and keeps the repeated instant.
    const expected: SessionDotInstants = new Map([
        ["a", [Date.parse("2026-06-01T10:00:00Z"), Date.parse("2026-06-01T10:00:00Z"), Date.parse("2026-06-01T10:30:00Z")]],
        ["b", [Date.parse("2026-06-01T09:00:00Z")]],
    ]);
    assert.deepEqual(instants, expected);
});
