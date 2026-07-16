import { test } from "node:test";
import assert from "node:assert/strict";
import { TraceDetailMode, Verdict } from "../src/structures/vocabulary.ts";
import { renderTrace } from "../src/reconstruction_trace.ts";
import type { LinePartition } from "../src/reconstruction_parse_lines.ts";

// A raw assistant line carrying a Bash tool_use — used to exercise the detail render's type/kind/preview.
const BASH_RAW = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git commit -m wip" } }] },
});

// A small partition: a kept write line (5), a kept read-beacon line (9), an ignored prose line (7).
const PARTITION: LinePartition = {
    kept: [
        { lineNumber: 5, verdict: Verdict.write, raw: '{"type":"assistant"}' },
        { lineNumber: 9, verdict: Verdict.readBeacon, raw: '{"type":"user"}' },
    ],
    ignored: [{ lineNumber: 7, raw: BASH_RAW }],
};

test("test_renderTrace_emits_line_number_and_verdict_for_a_kept_line", () => {
    const out = renderTrace(PARTITION, {});
    assert.ok(out.includes("5: write"));
    assert.ok(out.includes("9: read-beacon"));
});

test("test_renderTrace_shows_all_rows_when_no_filter_is_set", () => {
    // Rows appear in line order: 5 (write), 7 (ignore — surfacing its record type), 9 (read-beacon).
    assert.equal(renderTrace(PARTITION, {}), "5: write\n7: ignore type:assistant\n9: read-beacon");
});

test("test_renderTrace_ignored_row_surfaces_the_record_type", () => {
    // A bare ignored row appends `type:<recordType>` so a drop shows what kind of line it was.
    const out = renderTrace(PARTITION, {});
    assert.ok(out.includes("7: ignore type:assistant"));
});

test("test_renderTrace_omits_ignored_lines_when_hideIgnored_is_true", () => {
    const out = renderTrace(PARTITION, { hideIgnored: true });
    assert.ok(!out.includes("ignore"));
    assert.equal(out, "5: write\n9: read-beacon");
});

test("test_renderTrace_omits_kept_lines_when_onlyIgnored_is_true", () => {
    const out = renderTrace(PARTITION, { onlyIgnored: true });
    assert.equal(out, "7: ignore type:assistant");
});

test("test_renderTrace_rejects_both_filters_at_once", () => {
    assert.throws(() => renderTrace(PARTITION, { hideIgnored: true, onlyIgnored: true }));
});

test("test_renderTrace_details_with_no_selector_enriches_all_rendered_rows", () => {
    const out = renderTrace(PARTITION, {
        details: { selector: { all: true }, mode: TraceDetailMode.previewOnly },
    });
    // Every row is enriched (each line carries " — type=").
    assert.equal(out.split("\n").length, 3);
    assert.ok(out.split("\n").every((row) => row.includes(" — type=")));
});

test("test_renderTrace_details_by_class_enriches_only_rows_of_that_verdict", () => {
    const out = renderTrace(PARTITION, {
        details: { selector: { byClass: Verdict.write }, mode: TraceDetailMode.previewOnly },
    });
    const rows = out.split("\n");
    assert.ok(rows.find((row) => row.startsWith("5: write"))!.includes(" — type="));
    assert.ok(!rows.find((row) => row.startsWith("9: read-beacon"))!.includes(" — type="));
});

test("test_renderTrace_details_by_line_shows_only_that_line_detailed", () => {
    // A byLine selector names one line, so the output is JUST that line — detailed — not every other row.
    const out = renderTrace(PARTITION, {
        details: { selector: { byLine: 7 }, mode: TraceDetailMode.previewOnly },
    });
    assert.equal(out.split("\n").length, 1);
    assert.ok(out.startsWith("7: ignore"));
    assert.ok(out.includes(" — type="));
    assert.ok(!out.includes("5: write"));
    assert.ok(!out.includes("9: read-beacon"));
});

test("test_renderTrace_details_previewOnly_shows_type_kind_and_a_short_preview", () => {
    const out = renderTrace(PARTITION, {
        details: { selector: { byLine: 7 }, mode: TraceDetailMode.previewOnly },
    });
    assert.ok(out.includes('7: ignore — type=assistant kind=Bash preview="git commit -m wip"'));
});

test("test_renderTrace_details_full_shows_the_pretty_printed_record", () => {
    const out = renderTrace(PARTITION, {
        details: { selector: { byLine: 7 }, mode: TraceDetailMode.full },
    });
    assert.ok(out.includes("7: ignore — type=assistant kind=Bash"));
    // The full record is pretty-printed (multi-line, indented JSON) rather than a one-line preview.
    assert.ok(out.includes('"command": "git commit -m wip"'));
});

