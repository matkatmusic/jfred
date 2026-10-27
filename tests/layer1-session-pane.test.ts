// The JSONLs pane draws one row per visible session and a no-matches line for a search nothing matches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSessionPane } from "../webapp/layer1-session-pane.ts";
import { loadLayer1Sessions, resetSessionSelection } from "../webapp/layer1-sessions.ts";
import { writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const SESSION = { file: "a.jsonl", fullPath: "/p/a.jsonl", titles: ["alpha", "alpha"],
    started: "2026-06-01T08:44:00Z", ended: "2026-06-01T09:12:00Z", paths: ["src/a.ts"] };

async function openPane(): Promise<void> {
    initLayer1Dom();
    writeSourcePaths(SourceKind.jsonl, ["/p"]);
    stubStreamRoute("/api/layer1-sessions", [{ sessions: [SESSION] }]);
    resetSessionSelection();
    await loadLayer1Sessions();
    renderSessionPane(() => {});
}

test("test_renderSessionPane_draws_one_row_with_distinct_titles", async () => {
    await openPane();
    assert.equal(document.querySelectorAll(".session-item").length, 1);
    assert.equal(document.querySelectorAll(".session-item .stitle").length, 1);
});

test("test_renderSessionPane_shows_no_matches_for_an_unmatched_search", async () => {
    await openPane();
    (document.getElementById("session-search") as HTMLInputElement).value = "zzz";
    renderSessionPane(() => {});
    assert.equal(document.querySelector("#sessions .navempty")!.textContent, "no matches");
});
