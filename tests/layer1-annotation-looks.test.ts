// Task 382: every session record kind has one look and one label letter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ANNOTATION_LOOKS } from "../webapp/layer1-components/session-column/layer1-annotation-looks.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

const KINDS = Object.values(WireRecordKind);

test("test_every_record_kind_has_a_look", () => {
    // Scenario: the look table covers each wire record kind and nothing else.
    assert.deepEqual(Object.keys(ANNOTATION_LOOKS).sort(), [...KINDS].sort());
});

test("test_look_classes_are_unique_and_start_with_a_dash_kind_prefix", () => {
    // Scenario: the shape rule of one kind never styles another kind.
    const classes = KINDS.map((kind) => ANNOTATION_LOOKS[kind].cssClass);
    assert.equal(new Set(classes).size, KINDS.length);
    assert.ok(classes.every((cssClass) => cssClass.startsWith("a-")));
});

test("test_look_letters_are_unique", () => {
    // Scenario: two kinds never print the same label letter.
    const letters = KINDS.map((kind) => ANNOTATION_LOOKS[kind].letter);
    assert.equal(new Set(letters).size, KINDS.length);
});

test("test_dot_letters_are_eight_distinct_single_characters", () => {
    // Scenario: dots show the bare letter; the bubble label keeps its brackets.
    const dotLetters = KINDS.map((kind) => ANNOTATION_LOOKS[kind].dotLetter);
    assert.equal(new Set(dotLetters).size, 8);
    assert.deepEqual(dotLetters.sort(), "u a t r h m n ?".split(" ").sort());
    assert.ok(KINDS.every((kind) => ANNOTATION_LOOKS[kind].letter === `[${ANNOTATION_LOOKS[kind].dotLetter}]`));
});

test("test_the_unknown_kind_reads_as_a_question_mark", () => {
    // Scenario: the catch-all kind prints [?].
    assert.equal(ANNOTATION_LOOKS[WireRecordKind.unknown].letter, "[?]");
    assert.equal(ANNOTATION_LOOKS[WireRecordKind.unknown].cssClass, "a-unknown");
});

test("test_the_look_classes_match_the_plan_names", () => {
    // Scenario: the CSS owner styles exactly these eight class names.
    const classes = KINDS.map((kind) => ANNOTATION_LOOKS[kind].cssClass).sort();
    assert.deepEqual(classes, [
        "a-assistant", "a-attachment", "a-custom-title", "a-permission-mode",
        "a-tool-result", "a-tool-use", "a-unknown", "a-user",
    ]);
});
