// Left slack sits after the ruler, so the ruler stays at the left edge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../webapp/layer1-styles.css", import.meta.url), "utf8");

function readRuleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} rule is missing`);
  return css.slice(start, css.indexOf("}", start));
}

test("test_the_timelines_pane_gets_no_left_slack_padding", () => {
  assert.doesNotMatch(readRuleBody(".timelines"), /--slack-left/);
});

test("test_the_stage_after_the_ruler_gets_the_left_slack_divided_by_zoom", () => {
  const body = readRuleBody(".ruler + .stage");
  assert.match(body, /margin-left: calc\(var\(--slack-left, 0px\) \/ var\(--zoom, 1\)\)/);
});
