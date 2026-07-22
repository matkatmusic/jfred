// DOM tests for webapp/app-paths-summary.ts (task 159): the summary panel's rows (global vs
// per-project, values from the popover's current fields) and the screen-4 default-commit
// label resolution (stored baseline first, else the repo tip from /api/repo-commits).

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupWebappDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

const STORED_COMMIT_HASH = "a".repeat(40);
const TIP_COMMIT_HASH = "b".repeat(40);

function getInput(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
}

test("test_renderPathsSummary_shows_global_rows_without_a_project", async () => {
    // Scenario: with no project, only the two GLOBAL rows render — projects folder (field
    // value) and file history ("auto-derived" while the task-136 fields are hidden).
    setupWebappDom();
    const { renderPathsSummary } = await import("../webapp/app-paths-summary.ts");
    getInput("projects-dir-input").value = "/tmp/projects";
    renderPathsSummary(undefined, () => {});
    const rows = [...document.getElementById("paths-summary-rows")!.querySelectorAll(".summary-row")];
    assert.equal(rows.length, 2);
    assert.ok(rows[0]!.textContent!.includes("/tmp/projects"));
    assert.ok(rows[1]!.textContent!.includes("auto-derived"));
});

test("test_renderPathsSummary_project_rows_reflect_fields_and_mirror", async () => {
    // Scenario: with a project, rows 3–5 render from the repo field, the base-commit display
    // (short hash), and the task-56 baseline mirror; each row's Edit passes its screen number.
    setupWebappDom();
    const { renderPathsSummary } = await import("../webapp/app-paths-summary.ts");
    const { storeBaselineChoice } = await import("../webapp/app-choices.ts");
    getInput("repo-dir-input").value = "/repos/p";
    getInput("base-commit-display").value = STORED_COMMIT_HASH;
    storeBaselineChoice("proj-rows", "0");
    const editedScreens: number[] = [];
    renderPathsSummary("proj-rows", (screenNumber) => editedScreens.push(screenNumber));
    const rows = [...document.getElementById("paths-summary-rows")!.querySelectorAll(".summary-row")];
    assert.equal(rows.length, 5);
    assert.ok(rows[2]!.textContent!.includes("/repos/p"));
    assert.ok(rows[3]!.textContent!.includes(STORED_COMMIT_HASH.slice(0, 12)));
    assert.ok(rows[4]!.textContent!.includes("no"));
    // every row carries an Edit button wired to its own screen.
    for (const row of rows) {
        (row.querySelector(".summary-edit") as HTMLElement).click();
    }
    assert.deepEqual(editedScreens, [1, 2, 3, 4, 5]);
});

test("test_resolveDefaultCommitLabel_prefers_stored_then_repo_tip", async () => {
    // Scenario: a stored base commit labels as the session baseline without fetching; an empty
    // display resolves the repo tip from /api/repo-commits' newest row (never a hardcoded branch).
    setupWebappDom();
    stubFetchRoutes({
        "/api/repo-commits": [{ hash: TIP_COMMIT_HASH, date: "2026-07-22", subject: "tip subject" }],
    });
    const { resolveDefaultCommitLabel } = await import("../webapp/app-paths-summary.ts");
    getInput("base-commit-display").value = STORED_COMMIT_HASH;
    const storedLabel = await resolveDefaultCommitLabel("proj-label");
    assert.ok(storedLabel.includes(STORED_COMMIT_HASH.slice(0, 12)), storedLabel);
    assert.ok(storedLabel.includes("session baseline"), storedLabel);
    getInput("base-commit-display").value = "";
    getInput("repo-dir-input").value = "/repos/p";
    const tipLabel = await resolveDefaultCommitLabel("proj-label");
    await flushAsyncWork();
    assert.ok(tipLabel.includes(TIP_COMMIT_HASH.slice(0, 12)), tipLabel);
    assert.ok(tipLabel.includes("tip subject"), tipLabel);
    assert.ok(tipLabel.includes("repo tip"), tipLabel);
});
