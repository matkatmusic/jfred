// L9 redesign: letter dots, session lines, and the dot hover popup text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireAnnotation } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { Placement } from "../webapp/layer1-components/session-column/layer1-annotation-window.ts";

initLayer1Dom();
const { buildNode, buildSessionLine, readDotPopup, STAMPLESS_NOTE } = await import("../webapp/layer1-components/session-column/layer1-annotation-dots.ts");

const LOOK = { laneX: 46, color: "hsl(10 65% 60%)" };

function buildPlacement(id: string, axisPx: number, extra: Partial<WireAnnotation> = {}): Placement {
    const annotation: WireAnnotation = {
        id, kind: WireRecordKind.assistant, instant: "2026-06-01T10:00:00Z", label: `label ${id}`, sessionId: "s1", sessionTitle: "session one",
        sessionFile: "/fixture/demo/projects/s1.jsonl", line: 1000, ...extra,
    };
    return { annotation, axisPx, stack: 0 };
}

test("test_a_dot_carries_its_session_file_and_line", () => {
    // Steps: build a dot for a placement with a session file and line, then read its data attributes.
    const dot = buildNode(buildPlacement("a", 30, { sessionFile: "/x/s9.jsonl", line: 1042 }), LOOK);
    assert.equal(dot.dataset["sessionFile"], "/x/s9.jsonl");
    assert.equal(dot.dataset["line"], "1042");
});

test("test_a_dot_shows_the_letter_only_and_carries_the_session_look", () => {
    const dot = buildNode(buildPlacement("a", 30), LOOK);
    assert.equal(dot.textContent, "a");
    assert.equal(dot.dataset["sessionId"], "s1");
    assert.equal(dot.dataset["sessionTitle"], "session one");
    assert.equal(dot.style.getPropertyValue("--lane-x"), "46px");
    assert.equal(dot.style.getPropertyValue("--session-color"), LOOK.color);
    assert.equal(dot.hasAttribute("title"), false);
});

test("test_a_session_line_runs_from_the_first_dot_to_the_last_dot", () => {
    const line = buildSessionLine([buildPlacement("a", 30), buildPlacement("b", 130)], LOOK);
    assert.ok(line.classList.contains("sline"));
    assert.equal(line.dataset["sessionId"], "s1");
    assert.equal(line.style.getPropertyValue("--axis-px"), "30");
    assert.equal(line.style.getPropertyValue("--span-px"), "100");
});

test("test_the_popup_reader_returns_title_and_label_and_adds_the_stampless_note", () => {
    const plain = readDotPopup(buildNode(buildPlacement("a", 30), LOOK))!;
    assert.deepEqual(plain.lines, ["session one", "label a"]);
    assert.equal(plain.backgroundColor, LOOK.color);
    const stampless = readDotPopup(buildNode(buildPlacement("b", 30, { isStampless: true }), LOOK))!;
    assert.deepEqual(stampless.lines, ["session one", "label b", STAMPLESS_NOTE]);
});

test("test_the_popup_reader_ignores_a_target_that_is_not_a_dot", () => {
    assert.equal(readDotPopup(document.createElement("div")), undefined);
});
