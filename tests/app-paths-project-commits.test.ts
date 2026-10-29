// DOM smoke test for webapp/app-paths-project-commits.ts: the pick list, its filter box, and the match warning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initWebappDom } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";

const FIRST_COMMIT_HASH = "a".repeat(40);
const SECOND_COMMIT_HASH = "b".repeat(40);

// The element with `id`, asserted present: a missing id fails the test naming the id.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

test("test_open_pick_list_renders_one_row_per_commit", async () => {
    // Scenario: opening the list fetches the repo's commits and renders one row each, with the filter box shown.
    initWebappDom();
    installFetchRoutes({
        "/api/repo-commits": [
            { hash: FIRST_COMMIT_HASH, date: "2026-07-21", subject: "newest change" },
            { hash: SECOND_COMMIT_HASH, date: "2026-07-20", subject: "older change" },
        ],
    });
    const { openCommitPickList } = await import("../webapp/app-paths-project-commits.ts");
    await openCommitPickList("proj-a");
    const pickList = getRequiredElementById("commit-pick-list");
    assert.equal(pickList.hidden, false);
    assert.equal(getRequiredElementById("commit-pick-filter").hidden, false);
    const rows = [...pickList.querySelectorAll(".commit-pick-row")];
    assert.equal(rows.length, 2);
    assert.ok(rows[1]!.textContent!.includes(SECOND_COMMIT_HASH.slice(0, 8)));
    assert.ok(rows[1]!.textContent!.includes("older change"));
});

test("test_pick_row_fills_base_commit_and_warns_on_poor_match", async () => {
    // Scenario: picking a row fills the base commit; a poor path match shows the warning.
    initWebappDom();
    installFetchRoutes({
        "/api/repo-commits": [{ hash: FIRST_COMMIT_HASH, date: "2026-07-21", subject: "newest change" }],
        "/api/repo-commit-match": { matchedCount: 1, totalCount: 4 },
    });
    const { openCommitPickList } = await import("../webapp/app-paths-project-commits.ts");
    await openCommitPickList("proj-a");
    (getRequiredElementById("commit-pick-list").querySelector(".commit-pick-row") as HTMLElement).click();
    await waitForAsyncWork();
    assert.equal((getRequiredElementById("base-commit-display") as HTMLInputElement).value, FIRST_COMMIT_HASH);
    assert.equal(getRequiredElementById("commit-pick-list").hidden, true);
    assert.ok(getRequiredElementById("commit-match-warning").textContent!.includes("1 of 4"));
});

test("test_pick_row_with_good_match_leaves_warning_empty", async () => {
    // Scenario: when at least half of the recorded paths match, the warning stays empty.
    initWebappDom();
    installFetchRoutes({
        "/api/repo-commits": [{ hash: FIRST_COMMIT_HASH, date: "2026-07-21", subject: "newest change" }],
        "/api/repo-commit-match": { matchedCount: 3, totalCount: 4 },
    });
    const { openCommitPickList } = await import("../webapp/app-paths-project-commits.ts");
    await openCommitPickList("proj-a");
    (getRequiredElementById("commit-pick-list").querySelector(".commit-pick-row") as HTMLElement).click();
    await waitForAsyncWork();
    assert.equal(getRequiredElementById("commit-match-warning").textContent, "");
});
