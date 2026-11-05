// The page probe in a small fake page: paths name tag, id, classes and sibling index, plus both pseudo-elements.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { LIST_SHEET_PROPERTY_NAMES, STYLE_PROBE, type PageStyleSnapshot } from "../scripts/visual/computed-style-page-probe.ts";

test("every element gets a path and a ::before and ::after entry", () => {
  const window = new Window();
  // happy-dom style objects have length and indexes but no iterator, which Chrome has.
  Object.assign(window.CSSStyleDeclaration.prototype, { [Symbol.iterator]: Array.prototype[Symbol.iterator] });
  window.document.body.innerHTML = `<div id="go" class="pill big"></div>`;
  const snapshot = window.eval(STYLE_PROBE) as PageStyleSnapshot;
  const paths = snapshot.elements.map((entry) => entry[0]);
  assert.ok(paths.includes("html[0] > body[1] > div#go.pill.big[0]"));
  assert.ok(paths.includes("html[0] > body[1] > div#go.pill.big[0]::before"));
  assert.ok(paths.includes("html[0] > body[1] > div#go.pill.big[0]::after"));
  assert.equal(snapshot.rows[0]!.length, snapshot.properties.length);
  window.close();
});

test("the sheet walk follows imported sheets and grouping rules and lists each name once", () => {
  const listNames = new Function(`return ${LIST_SHEET_PROPERTY_NAMES}`)() as (sheets: unknown) => string[];
  const sheets = [{ cssRules: [
    { styleSheet: { cssRules: [{ style: ["color", "--ink"] }] } },
    { cssRules: [{ style: ["margin-top", "color"] }] },
    { style: ["display"] },
  ] }];
  assert.deepEqual(listNames(sheets), ["--ink", "color", "display", "margin-top"]);
});
