// DOM smoke test for webapp/app-paths-project.ts (task 137): the Paths popover's per-project
// repo/commit picker — the commit pick list renders from /api/repo-commits, picking a row
// fills the base-commit field, and a poor path-match count renders the soft warning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupWebappDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

const FIRST_COMMIT_HASH = "a".repeat(40);
const SECOND_COMMIT_HASH = "b".repeat(40);

// The element with `id`, asserted present — a missing id fails the test naming the id.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

test("test_commit_pick_list_renders_and_pick_fills_base_commit", async () => {
    // Scenario (task 137): with a repo path in the field, "Pick commit…" fetches the repo's
    // commits and renders a scrollable pick list; clicking a row fills the base-commit field
    // and fetches the path-match counts, whose poor ratio renders the soft warning.
    // Steps:
    // boot a fresh DOM, stub the three routes the section touches, refresh it for a project.
    setupWebappDom();
    stubFetchRoutes({
        "/api/project-paths": { repo: "/repos/p" },
        "/api/repo-commits": [
            { hash: FIRST_COMMIT_HASH, date: "2026-07-21", subject: "newest change" },
            { hash: SECOND_COMMIT_HASH, date: "2026-07-20", subject: "older change" },
        ],
        "/api/repo-commit-match": { matchedCount: 1, totalCount: 4 },
    });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-a");
    // the section unhides and prefills the repo field from the merged entry.
    assert.equal(getRequiredElementById("project-paths-section").hidden, false);
    assert.equal((getRequiredElementById("repo-dir-input") as HTMLInputElement).value, "/repos/p");
    // clicking Pick commit… renders one row per commit, newest first.
    getRequiredElementById("pick-commit-btn").click();
    await flushAsyncWork();
    const pickList = getRequiredElementById("commit-pick-list");
    assert.equal(pickList.hidden, false);
    const rows = [...pickList.querySelectorAll(".commit-pick-row")];
    assert.equal(rows.length, 2);
    // each row shows the short hash, the date, and the subject.
    assert.ok(rows[0]!.textContent!.includes(FIRST_COMMIT_HASH.slice(0, 8)));
    assert.ok(rows[0]!.textContent!.includes("2026-07-21"));
    assert.ok(rows[0]!.textContent!.includes("newest change"));
    // picking the first row fills the base-commit field with the FULL hash and hides the list.
    (rows[0] as HTMLElement).click();
    await flushAsyncWork();
    assert.equal((getRequiredElementById("base-commit-display") as HTMLInputElement).value, FIRST_COMMIT_HASH);
    assert.equal(pickList.hidden, true);
    // 1 of 4 recorded paths matching is a poor ratio — the soft warning names the counts.
    const warningText = getRequiredElementById("commit-match-warning").textContent!;
    assert.ok(warningText.includes("1 of 4"), `warning names the counts: ${warningText}`);
});
