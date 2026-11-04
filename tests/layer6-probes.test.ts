// Tests for scripts/visual/layer6-probes.ts: builder output and browser-expression syntax.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as probes from "../scripts/visual/layer6-probes.ts";

const parseExpression = (expression: string) => new Function(`return (${expression});`);

test("buildNodeExpression puts the tool use id inside the node selector", () => {
  const expression = probes.buildNodeExpression("toolu_abc123");
  assert.ok(expression.includes('data-tool-use-id="toolu_abc123"'));
  assert.ok(expression.startsWith("document.querySelector("));
  assert.notEqual(expression, probes.buildNodeExpression("toolu_other"));
});

test("the dot builders wrap the node expression for the id they get", () => {
  assert.ok(probes.buildDotClasses("toolu_a").endsWith(".className"));
  assert.ok(probes.buildScrollToDot("toolu_a").includes("scrollIntoView"));
  assert.ok(probes.buildDotInView("toolu_a").includes('data-tool-use-id="toolu_a"'));
  assert.notEqual(probes.buildDotClasses("toolu_a"), probes.buildDotClasses("toolu_b"));
});

test("buildRunPostProbe and buildNeedsProbe name the id and the route", () => {
  const post = probes.buildRunPostProbe("toolu_a");
  assert.ok(post.includes("/api/layer1-script-run") && post.includes("toolu_a"));
  const needs = probes.buildNeedsProbe("toolu_a");
  assert.ok(needs.includes("/api/layer1-script-needs") && needs.includes("toolu_a"));
  assert.ok(probes.CLEAR_RESULTS_PROBE.includes("/api/layer1-clear-results"));
});

test("every expression string parses as JavaScript", () => {
  const expressionNames: string[] = [];
  for (const [name, value] of Object.entries(probes)) {
    const isString = typeof value === "string";
    const isId = name.endsWith("_ID");
    if (isString && !isId) {
      expressionNames.push(name);
      assert.doesNotThrow(() => parseExpression(value), `${name} does not parse`);
    }
  }
  assert.ok(expressionNames.length >= 10, `only ${expressionNames.length} expressions found`);
});

test("builder output parses as JavaScript", () => {
  assert.doesNotThrow(() => parseExpression(probes.buildNodeExpression(probes.PENDING_ID)));
  assert.doesNotThrow(() => parseExpression(probes.buildDotInView(probes.PENDING_ID)));
  assert.doesNotThrow(() => parseExpression(probes.buildRunPostProbe(probes.PENDING_ID)));
  assert.doesNotThrow(() => parseExpression(probes.buildNeedsProbe(probes.BLOCKED_ID)));
});

test("a broken expression is caught by the parse check", () => {
  assert.throws(() => parseExpression("document.querySelector("));
});

test("every fixture id is a distinct toolu_fixture_l6 string", () => {
  const ids = new Set<string>();
  let idCount = 0;
  for (const [name, value] of Object.entries(probes)) {
    if (name.endsWith("_ID")) {
      idCount += 1;
      ids.add(String(value));
      assert.match(String(value), /^toolu_fixture_l6_/);
    }
  }
  assert.equal(idCount, 17);
  assert.equal(ids.size, idCount);
});
