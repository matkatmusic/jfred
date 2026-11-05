// The compared property list: rule-text names, shorthands as longhands, shared custom names only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { listCssTextPropertyNames, listLonghandNames, selectComparedProperties } from "../scripts/visual/computed-style-property-list.ts";

test("rule text gives the declared names, not selectors or comments", () => {
  const text = `/* a: b */ .x:hover { color: red; margin: 0 } @media (max-width: 9px) { .y { --ink: #fff; } }`;
  assert.deepEqual(listCssTextPropertyNames(text), ["--ink", "color", "margin"]);
});

test("a shorthand becomes the captured longhands it sets", () => {
  const captured = ["color", "margin-top", "margin-left", "top", "left", "display"];
  assert.deepEqual(listLonghandNames(["color", "margin", "inset"], captured), ["color", "left", "margin-left", "margin-top", "top"]);
});

test("a custom name that one capture lacks is skipped and counted", () => {
  const selected = selectComparedProperties(["--ink", "color"], ["--ink", "color"], ["color"]);
  assert.deepEqual(selected, { names: ["color"], skippedCustomNames: ["--ink"] });
});
