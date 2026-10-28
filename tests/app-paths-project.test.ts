// DOM smoke test for app-paths-project.ts (task 137): per-project repo/commit picker, pick list, soft warning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initWebappDom } from "./webapp-dom-test-helpers.ts";
import { stubFetchRoutes } from "./webapp-fetch-test-helpers.ts";

const FIRST_COMMIT_HASH = "a".repeat(40);
const SECOND_COMMIT_HASH = "b".repeat(40);

// Fire an "input" event like a keystroke; happy-dom rejects Node's Event, so build it from the window.
function dispatchInputEvent(input: HTMLInputElement): void {
    const happyDomEventClass = (window as unknown as { Event: typeof Event }).Event;
    input.dispatchEvent(new happyDomEventClass("input"));
}

// The element with `id`, asserted present — a missing id fails the test naming the id.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

test("test_commit_pick_list_renders_and_pick_fills_base_commit", async () => {
    // Scenario (task 137): "Pick commit…" lists commits; a clicked row fills the base commit; poor matches warn.
    initWebappDom();
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
    await waitForAsyncWork();
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
    await waitForAsyncWork();
    assert.equal((getRequiredElementById("base-commit-display") as HTMLInputElement).value, FIRST_COMMIT_HASH);
    assert.equal(pickList.hidden, true);
    // 1 of 4 recorded paths matching is a poor ratio — the soft warning names the counts.
    const warningText = getRequiredElementById("commit-match-warning").textContent!;
    assert.ok(warningText.includes("1 of 4"), `warning names the counts: ${warningText}`);
});

test("test_refresh_prefills_file_history_field_from_stored_override", async () => {
    // Scenario (task 153): a stored fileHistory entry fills the task-136 field on refresh; a project without one restores.
    initWebappDom();
    stubFetchRoutes({ "/api/project-paths": { repo: "/repos/p", fileHistory: "/stored/fh" } });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-a");
    // the task-136 fields unhide and carry the stored override.
    assert.equal(getRequiredElementById("file-history-fields").hidden, false);
    assert.equal((getRequiredElementById("file-history-dir-input") as HTMLInputElement).value, "/stored/fh");
    // refresh for a project WITHOUT an override: fields hide, value restores to derived dir ("" here).
    stubFetchRoutes({ "/api/project-paths": { repo: "/repos/q" } });
    await refreshProjectPathsSection("proj-b");
    assert.equal(getRequiredElementById("file-history-fields").hidden, true);
    assert.equal((getRequiredElementById("file-history-dir-input") as HTMLInputElement).value, "");
});

test("test_commit_pick_filter_narrows_rows", async () => {
    // Scenario (task 154): typing in the filter narrows the pick list (hash, date, subject); clearing restores all.
    initWebappDom();
    stubFetchRoutes({
        "/api/project-paths": { repo: "/repos/p" },
        "/api/repo-commits": [
            { hash: FIRST_COMMIT_HASH, date: "2026-07-21", subject: "newest change" },
            { hash: SECOND_COMMIT_HASH, date: "2026-07-20", subject: "older change" },
        ],
        "/api/repo-commit-match": { matchedCount: 4, totalCount: 4 },
    });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-a");
    getRequiredElementById("pick-commit-btn").click();
    await waitForAsyncWork();
    // opening the list also unhides the filter box, empty.
    const filterInput = getRequiredElementById("commit-pick-filter") as HTMLInputElement;
    assert.equal(filterInput.hidden, false);
    assert.equal(filterInput.value, "");
    const pickList = getRequiredElementById("commit-pick-list");
    // type a subject fragment ("NEWEST", uppercase) and fire an input event.
    filterInput.value = "NEWEST";
    dispatchInputEvent(filterInput);
    // exactly one row remains and it names the matching subject.
    const narrowedRows = [...pickList.querySelectorAll(".commit-pick-row")];
    assert.equal(narrowedRows.length, 1);
    assert.ok(narrowedRows[0]!.textContent!.includes("newest change"));
    // clearing the filter restores both rows.
    filterInput.value = "";
    dispatchInputEvent(filterInput);
    assert.equal(pickList.querySelectorAll(".commit-pick-row").length, 2);
    // picking a row hides the filter box together with the list.
    filterInput.value = "older";
    dispatchInputEvent(filterInput);
    ([...pickList.querySelectorAll(".commit-pick-row")][0] as HTMLElement).click();
    await waitForAsyncWork();
    assert.equal(pickList.hidden, true);
    assert.equal(filterInput.hidden, true);
    assert.equal((getRequiredElementById("base-commit-display") as HTMLInputElement).value, SECOND_COMMIT_HASH);
});
