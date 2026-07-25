// Task 183: the per-file debug viewer's page skeleton — file selection listing deep-link
// anchors, a status line, and boot behavior for the three URL shapes (no project, project
// only, project + deep-linked file). Task 184: rendering the selected file's revision ladder
// (index, source attribution, timestamp, seed hash, conflict note).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupDebugDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// The element with `id`, asserting it exists.
function getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element, `missing #${id}`);
    return element as HTMLElement;
}

test("test_debug_page_renders_file_list_and_status_regions", async () => {
    // Scenario: debug.html carries the skeleton regions.
    // Steps:
    // load the debug page body into a fresh DOM (no project param — boot stays fetch-free).
    setupDebugDom();
    await import("../webapp/debug-app.ts");
    // the status line and the file-selection list are both present.
    getById("debug-status");
    getById("debug-file-list");
});

test("test_renderDebugFileList_builds_deep_link_anchors", async () => {
    // Scenario: each listed file is an anchor deep-linking to this page with project + file params.
    // Steps:
    // render one file into the list.
    setupDebugDom();
    const { renderDebugFileList } = await import("../webapp/debug-app.ts");
    renderDebugFileList("proj", ["/w/alpha.py"]);
    // the entry is an <a> whose href round-trips the deep link and whose text names the path.
    const anchor = getById("debug-file-list").querySelector("a");
    assert.ok(anchor, "no anchor rendered");
    assert.equal(anchor?.getAttribute("href"), "/app/debug.html?project=proj&file=%2Fw%2Falpha.py");
    assert.equal(anchor?.textContent, "/w/alpha.py");
});

test("test_debug_boot_without_project_shows_guidance", async () => {
    // Scenario: with no ?project the page explains how to open it instead of fetching.
    // Steps:
    // boot over a paramless URL.
    setupDebugDom();
    const { bootDebugApp } = await import("../webapp/debug-app.ts");
    await bootDebugApp();
    // the status names the missing project selection.
    assert.match(getById("debug-status").textContent ?? "", /no project selected/);
});

test("test_debug_boot_with_project_fetches_and_renders_file_list", async () => {
    // Scenario: ?project=proj fetches the ladder file list and renders the deep-link anchors.
    // Steps:
    // boot over a project URL with the list response stubbed.
    setupDebugDom("?project=proj");
    stubFetchRoutes({ "/api/file-ladder": { files: ["/w/alpha.py"] } });
    const { bootDebugApp } = await import("../webapp/debug-app.ts");
    await bootDebugApp();
    // one anchor per listed file appears, and the status invites a pick.
    assert.equal(getById("debug-file-list").querySelectorAll("a").length, 1);
    assert.match(getById("debug-status").textContent ?? "", /select a file/);
});

// Two revisions in the wire shape /api/file-ladder serves: a base-commit seed (its
// `gitBase:<hash>:<target>` changeId) followed by an edit the engine could not replay.
const LADDER_PAYLOAD = {
    target: "/w/alpha.py",
    revisions: [
        { kind: "write", changeId: "gitBase:9d14d60d:/w/alpha.py", timestamp: "2026-05-01T10:00:00.000Z" },
        {
            kind: "edit",
            changeId: "toolu_02",
            timestamp: "2026-05-02T11:30:00.000Z",
            unrecoverable: { reason: "hunk context not found" },
        },
    ],
};

test("test_debug_boot_with_deep_linked_file_renders_the_ladder", async () => {
    // Scenario: ?project&file fetches that file's ladder, renders one list entry per revision,
    // and reports the count.
    // Steps:
    // boot over a deep-linked URL with the ladder response stubbed.
    setupDebugDom("?project=proj&file=%2Fw%2Falpha.py");
    stubFetchRoutes({ "/api/file-ladder": LADDER_PAYLOAD });
    const { bootDebugApp } = await import("../webapp/debug-app.ts");
    await bootDebugApp();
    // one <li> per revision appears, and the status names the file and its 2 fetched revisions.
    assert.equal(getById("debug-ladder").querySelectorAll("li").length, 2);
    assert.match(getById("debug-status").textContent ?? "", /alpha\.py/);
    assert.match(getById("debug-status").textContent ?? "", /2 revision/);
});

test("test_renderDebugLadder_attributes_each_revision_to_its_source_and_time", async () => {
    // Scenario: every revision row names the event kind that produced it, its changeId, and its
    // timestamp — the debug viewer's source attribution.
    // Steps:
    // render the two-revision ladder.
    setupDebugDom();
    const { renderDebugLadder } = await import("../webapp/debug-app.ts");
    renderDebugLadder(LADDER_PAYLOAD);
    // the first entry attributes itself to the write event and carries that revision's timestamp.
    const firstItem = getById("debug-ladder").querySelector("li");
    assert.match(firstItem?.querySelector(".debug-source")?.textContent ?? "", /write \(gitBase:9d14d60d/);
    assert.equal(firstItem?.querySelector(".debug-time")?.textContent, "2026-05-01T10:00:00.000Z");
});

test("test_renderDebugLadder_shows_the_seed_hash_only_on_base_commit_revisions", async () => {
    // Scenario: a `gitBase:<hash>:<target>` changeId surfaces its commit hash; an ordinary
    // changeId shows no seed row.
    // Steps:
    // render the two-revision ladder.
    setupDebugDom();
    const { renderDebugLadder } = await import("../webapp/debug-app.ts");
    renderDebugLadder(LADDER_PAYLOAD);
    // only the seeded revision carries a seed, and it names the commit hash alone.
    const seeds = getById("debug-ladder").querySelectorAll(".debug-seed");
    assert.equal(seeds.length, 1);
    assert.equal(seeds[0]?.textContent, "9d14d60d");
});

test("test_renderDebugLadder_shows_conflict_notes_on_unrecoverable_revisions", async () => {
    // Scenario: a revision the engine could not replay shows its reason instead of passing as a
    // clean revision.
    // Steps:
    // render the two-revision ladder.
    setupDebugDom();
    const { renderDebugLadder } = await import("../webapp/debug-app.ts");
    renderDebugLadder(LADDER_PAYLOAD);
    // exactly the unrecoverable revision carries the note, and it names the reason.
    const notes = getById("debug-ladder").querySelectorAll(".debug-conflict");
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.textContent, "hunk context not found");
});

test("test_debug_boot_with_failed_fetch_reports_the_failure", async () => {
    // Scenario: a failed list fetch surfaces in the status line instead of a silent empty page.
    // Steps:
    // boot over a project URL with NO stub for the route (the stub answers 404).
    setupDebugDom("?project=proj");
    stubFetchRoutes({});
    const { bootDebugApp } = await import("../webapp/debug-app.ts");
    await bootDebugApp();
    // the status carries the failure.
    assert.match(getById("debug-status").textContent ?? "", /failed/);
});
