// Page expressions of the computed-style states: theme by attribute, clicks by id.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClickElementExpression, buildSetThemeExpression } from "../scripts/visual/computed-style-states.ts";

test("the theme expression sets data-theme on the root element", () => {
  assert.equal(buildSetThemeExpression("dark"), "document.documentElement.dataset.theme = 'dark'");
});

test("the click expression clicks the element with that id", () => {
  assert.equal(buildClickElementExpression("dclose"), "document.getElementById('dclose').click()");
});
