// Tests for scripts/visual/layer9-probes.ts: builder output and browser-expression syntax.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as probes from "../scripts/visual/layer9-probes.ts";

const parseExpression = (expression: string) => new Function(`return (${expression});`);
const parseAsync = (expression: string) => new Function(`return async () => (${expression});`);

test("every Layer 9 expression string parses as JavaScript and holds no backtick", () => {
    let count = 0;
    for (const [name, value] of Object.entries(probes)) {
        if (typeof value !== "string" || /_(PREFIX|LABEL|PATTERN|HASH)$/.test(name))
            continue;
        count++;
        assert.doesNotThrow(() => parseAsync(value), `${name} does not parse`);
        assert.ok(!value.includes("`"), `${name} holds a backtick`);
    }
    assert.ok(count >= 15, `only ${count} expressions found`);
});

test("builder output parses as JavaScript", () => {
    assert.doesNotThrow(() => parseExpression(probes.buildFindTick(probes.TICK_LABELS.late)));
    assert.doesNotThrow(() => parseAsync(probes.buildClickTick(probes.TICK_LABELS.late)));
    assert.doesNotThrow(() => parseAsync(probes.buildClickEntry("c0ffee02")));
    assert.doesNotThrow(() => parseAsync(probes.buildRefusalClick(probes.TICK_LABELS.createdOnly)));
    assert.doesNotThrow(() => parseAsync(probes.buildSnapLines("2026-06-03T10:30:00.000Z")));
    assert.doesNotThrow(() => parseAsync(probes.buildBeaconInstantCount("2026-06-01T09:05:00.000Z", "2026-06-03T10:30:00.000Z")));
    assert.doesNotThrow(() => parseAsync(probes.buildTimeToggle("author")));
});

test("a tick is found by label prefix, and each builder carries its argument", () => {
    assert.ok(probes.buildFindTick("06-03 18:20:00.000").includes('startsWith("06-03 18:20:00.000")'));
    assert.ok(probes.buildClickTick("06-03 18:20:00.000").includes(".click()"));
    assert.ok(probes.buildClickEntry("c0ffee02").includes('data-short-hash="c0ffee02"'));
    assert.ok(probes.buildTimeToggle("author").includes("time-author"));
    assert.ok(probes.buildTimeToggle("committer").includes("time-committer"));
    assert.notEqual(probes.buildRefusalClick(probes.TICK_LABELS.createdOnly), probes.buildRefusalClick(probes.TICK_LABELS.derivedOnly));
});

test("the refusal click hides the toast before the click, so only this click can show it", () => {
    const expression = probes.buildRefusalClick(probes.TICK_LABELS.createdOnly);
    assert.ok(expression.indexOf("toast.hidden = true") < expression.indexOf(".click()"));
});

test("a broken expression is caught by the parse check", () => {
    assert.throws(() => parseExpression("document.querySelector("));
});

test("test_every_tick_probe_reads_the_full_time_attribute_and_not_the_tick_text", () => {
    // The tick finder, the entry probe and the tick states all read dataset.fullTime.
    assert.ok(probes.buildFindTick(probes.TICK_LABELS.late).includes("t.dataset.fullTime.startsWith"));
    assert.ok(probes.ENTRY_FACTS.includes("t.dataset.fullTime.startsWith"));
    assert.ok(probes.TICK_STATES.includes("fullTime: t.dataset.fullTime"));
    // None of them finds a tick by its text content.
    assert.ok(!probes.buildFindTick(probes.TICK_LABELS.late).includes("textContent"));
    assert.ok(!probes.ENTRY_FACTS.includes("t.textContent.startsWith"));
    assert.ok(!probes.buildRefusalClick(probes.TICK_LABELS.createdOnly).includes("t.textContent.startsWith"));
});

test("test_strip_probes_read_the_strip_that_exists_only_in_commit_mode", () => {
    // The strip count is a plain count of #jfred-strip elements.
    assert.equal(probes.STRIP_COUNT, "document.querySelectorAll('#jfred-strip').length");
    // The head probe reads head text and Delete count; the stage probe reads the left edge.
    assert.ok(probes.STRIP_HEAD_FACTS.includes("deleteCount") && probes.STRIP_HEAD_FACTS.includes(".jhead span"));
    assert.ok(probes.STAGE_FACTS.includes("getElementById('stage')") && probes.STAGE_FACTS.includes("stripCount"));
    // The layout probes accept a page with no #annotation-track, since the session column is off at load.
    assert.ok(probes.STRIP_LAYOUT_FACTS.includes("track ? box('annotation-track').left : null"));
    assert.ok(probes.OVERLAP_FACTS.includes("track: track ? box(track) : null"));
});

test("test_rule_scan_pattern_holds_the_new_names_and_skips_no_rule", () => {
    // The pattern names the strip, mark and message rules and every new class of the ruler redesign.
    for (const name of ["jfred-strip", "cut-", "sline", "ahead", "ruler-head", "session-toggle", "ttime", "tcount", "s-coloured", "tf-", "hover-popup", "hp-line"])
        assert.ok(probes.CUT_RULE_PATTERN.includes(name), name);
    // No rule is skipped: the scan has no --page filter.
    assert.ok(!probes.CUT_RULE_TEXTS.includes("--page"));
});

test("the nine tick labels are distinct UTC prefixes in the ruler format", () => {
    const labels = Object.values(probes.TICK_LABELS);
    assert.equal(new Set(labels).size, 9);
    for (const label of labels)
        assert.match(label, /^\d\d-\d\d \d\d:\d\d:\d\d\.\d\d\d$/);
});

test("the literal phrases and the mode label are the ones task 383 names", () => {
    assert.equal(probes.FOOTNOTE_PREFIX, "reconstructed by JFRED @ ");
    assert.equal(probes.COMMIT_MODE_LABEL, "Commit mode");
});

test("the entry probe reads the six wire facts and the tick centre; the request count is the L7 one", () => {
    for (const field of ["kind", "shortHash", "parentHash", "instant", "cy", "tickCy"])
        assert.ok(probes.ENTRY_FACTS.includes(field), field);
    assert.ok(probes.MARK_FACTS.includes("performance.getEntriesByType('resource')"));
});
