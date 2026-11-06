// Task 382: every session record kind has one look and one label letter.

// not behavior: every test in this file only checks the values of the ANNOTATION_LOOKS constant table.
// import { test } from "node:test";
// import assert from "node:assert/strict";
// import { ANNOTATION_LOOKS } from "../webapp/layer1-components/session-column/layer1-annotation-looks.ts";
// import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
//
// const KINDS = Object.values(WireRecordKind);
//
// not behavior: it only checks that the constant table has one key per kind.
// test("test_every_record_kind_has_a_look", () => {
//     // Scenario: the look table covers each wire record kind and nothing else.
//     assert.deepEqual(Object.keys(ANNOTATION_LOOKS).sort(), [...KINDS].sort());
// });
//
// not behavior: it only checks that the constant table's css class values are unique and prefixed.
// test("test_look_classes_are_unique_and_start_with_a_dash_kind_prefix", () => {
//     // Scenario: the shape rule of one kind never styles another kind.
//     const classes = KINDS.map((kind) => ANNOTATION_LOOKS[kind].cssClass);
//     assert.equal(new Set(classes).size, KINDS.length);
//     assert.ok(classes.every((cssClass) => cssClass.startsWith("a-")));
// });
//
// not behavior: it only checks that the constant table's letter values are unique.
// test("test_look_letters_are_unique", () => {
//     // Scenario: two kinds never print the same label letter.
//     const letters = KINDS.map((kind) => ANNOTATION_LOOKS[kind].letter);
//     assert.equal(new Set(letters).size, KINDS.length);
// });
//
// not behavior: it only checks the constant table's dot letter values.
// test("test_dot_letters_are_eight_distinct_single_characters", () => {
//     // Scenario: dots show the bare letter; the bubble label keeps its brackets.
//     const dotLetters = KINDS.map((kind) => ANNOTATION_LOOKS[kind].dotLetter);
//     assert.equal(new Set(dotLetters).size, 8);
//     assert.deepEqual(dotLetters.sort(), "u a t r h m n ?".split(" ").sort());
//     assert.ok(KINDS.every((kind) => ANNOTATION_LOOKS[kind].letter === `[${ANNOTATION_LOOKS[kind].dotLetter}]`));
// });
//
// not behavior: it only checks two values of the constant table for the unknown kind.
// test("test_the_unknown_kind_reads_as_a_question_mark", () => {
//     // Scenario: the catch-all kind prints [?].
//     assert.equal(ANNOTATION_LOOKS[WireRecordKind.unknown].letter, "[?]");
//     assert.equal(ANNOTATION_LOOKS[WireRecordKind.unknown].cssClass, "a-unknown");
// });
//
// not behavior: it only checks the constant table's css class values against a list of names.
// test("test_the_look_classes_match_the_plan_names", () => {
//     // Scenario: the CSS owner styles exactly these eight class names.
//     const classes = KINDS.map((kind) => ANNOTATION_LOOKS[kind].cssClass).sort();
//     assert.deepEqual(classes, [
//         "a-assistant", "a-attachment", "a-custom-title", "a-permission-mode",
//         "a-tool-result", "a-tool-use", "a-unknown", "a-user",
//     ]);
// });
