// DOM smoke tests for webapp/app-header.ts (task 122): the config-driven folder inputs and the
// toolbar popover model, run against a happy-dom window carrying the real index.html markup
// (webapp-dom-test-helpers.ts installs the globals the webapp import chain expects).

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupWebappDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// Boot a fresh DOM, stub the two endpoints initializeHeader touches, and run it. The dynamic
// import keeps every webapp module load AFTER the globals exist; re-initializing per test is
// safe because initializeHeader re-resolves every element by id on each call, and listeners
// from a previous test's window resolve ids against that abandoned document.
async function initializeHeaderInFreshDom(): Promise<void> {
    setupWebappDom();
    stubFetchRoutes({
        "/api/config": { projectsDir: "/tmp/projects", fileHistoryDir: "/tmp/file-history", bootId: "boot-1" },
        "/api/projects": [{ name: "proj-a" }, { name: "proj-b" }],
    });
    const { initializeHeader } = await import("../webapp/app-header.ts");
    await initializeHeader();
}

// The element with `id`, asserted present — a missing id fails the test naming the id.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

test("test_initializeHeader_fills_folder_inputs_from_config", async () => {
    // Scenario: initializeHeader fetches /api/config and mirrors the reported folders into the
    // two Paths inputs.
    // Steps:
    // boot the DOM and run initializeHeader against the stubbed config.
    await initializeHeaderInFreshDom();
    // assert both folder inputs carry the stubbed config values.
    assert.equal((getRequiredElementById("projects-dir-input") as HTMLInputElement).value, "/tmp/projects");
    assert.equal((getRequiredElementById("file-history-dir-input") as HTMLInputElement).value, "/tmp/file-history");
});

test("test_projects_button_opens_menu_and_document_click_closes_it", async () => {
    // Scenario: the Projects button opens its popover (its stopPropagation keeps the
    // document-level closer out), the menu fills with one row per project, and a plain
    // document click closes every popover again.
    // Steps:
    // boot the DOM and run initializeHeader.
    await initializeHeaderInFreshDom();
    const projectsMenu = getRequiredElementById("projects-menu");
    // the menu starts hidden (index.html markup).
    assert.equal(projectsMenu.hidden, true);
    // click the Projects button: the popover opens despite the document-level closer.
    getRequiredElementById("projects-btn").click();
    assert.equal(projectsMenu.hidden, false);
    // the fire-and-forget populate settles: one .menu-item per stubbed project, in order.
    await flushAsyncWork();
    const menuItems = [...projectsMenu.querySelectorAll(".menu-item")];
    assert.deepEqual(menuItems.map((item) => item.textContent), ["proj-a", "proj-b"]);
    // a plain document-level click closes both popovers.
    document.body.click();
    assert.equal(projectsMenu.hidden, true);
    assert.equal(getRequiredElementById("paths-popover").hidden, true);
});

// task 136: the file-history field hides behind a toggle; hidden = "derive from the projects
// folder", so the apply POST always carries fileHistoryDir "" while the fields are hidden.

// Wrap the current stubbed fetch with a recorder so a test can inspect POST bodies while the
// canned routes keep answering.
function recordFetchCalls(): { url: string; init: RequestInit | undefined }[] {
    const recordedCalls: { url: string; init: RequestInit | undefined }[] = [];
    const delegate = globalThis.fetch;
    Object.assign(globalThis, {
        fetch: (url: unknown, init?: RequestInit) => {
            recordedCalls.push({ url: String(url), init });
            return delegate(String(url), init);
        },
    });
    return recordedCalls;
}

// The parsed JSON body of the recorded POST to /api/config, asserted present.
function getRecordedConfigPostBody(recordedCalls: { url: string; init: RequestInit | undefined }[]): { projectsDir: string; fileHistoryDir: string } {
    const configPost = recordedCalls.find((call) => call.url.includes("/api/config") && call.init?.method === "POST");
    assert.ok(configPost !== undefined, "a POST to /api/config was recorded");
    return JSON.parse(String(configPost.init!.body)) as { projectsDir: string; fileHistoryDir: string };
}

test("test_file_history_fields_start_hidden_and_toggle_shows_them", async () => {
    // Scenario (task 136): the file-history field + Open… button start hidden (derived dir);
    // the "Set File History Snapshots" button toggles their visibility.
    // Steps:
    // boot the DOM and run initializeHeader.
    await initializeHeaderInFreshDom();
    const fileHistoryFields = getRequiredElementById("file-history-fields");
    // the fields start hidden (index.html markup).
    assert.equal(fileHistoryFields.hidden, true);
    // clicking the toggle shows them.
    getRequiredElementById("file-history-toggle").click();
    assert.equal(fileHistoryFields.hidden, false);
    // clicking again hides them.
    getRequiredElementById("file-history-toggle").click();
    assert.equal(fileHistoryFields.hidden, true);
});

test("test_apply_posts_empty_file_history_while_fields_hidden", async () => {
    // Scenario (task 136): while the fields are hidden the dir is DERIVED — the apply POST
    // carries "" even when the (hidden) input holds text.
    // Steps:
    // boot the DOM, leave the fields hidden, put a value in the hidden input.
    await initializeHeaderInFreshDom();
    (getRequiredElementById("file-history-dir-input") as HTMLInputElement).value = "/tmp/should-not-post";
    const recordedCalls = recordFetchCalls();
    // apply the folder change.
    getRequiredElementById("projects-dir-change").click();
    await flushAsyncWork();
    // the POST body carries the empty derive marker, not the hidden text.
    assert.equal(getRecordedConfigPostBody(recordedCalls).fileHistoryDir, "");
});

test("test_apply_posts_edited_file_history_when_fields_shown", async () => {
    // Scenario (task 136): showing the fields is the explicit-override gesture — an edited
    // value posts through.
    // Steps:
    // boot the DOM, show the fields, edit the input.
    await initializeHeaderInFreshDom();
    getRequiredElementById("file-history-toggle").click();
    (getRequiredElementById("file-history-dir-input") as HTMLInputElement).value = "/tmp/custom-history";
    const recordedCalls = recordFetchCalls();
    // apply the folder change.
    getRequiredElementById("projects-dir-change").click();
    await flushAsyncWork();
    // the POST body carries the edited override.
    assert.equal(getRecordedConfigPostBody(recordedCalls).fileHistoryDir, "/tmp/custom-history");
});

// task 153: a stored per-project fileHistory override prefills the task-136 field on popover
// open (prefillFileHistoryOverrideField), and an UNEDITED prefill must never ride the GLOBAL
// "Change folder" POST as an explicit override.

test("test_prefill_with_override_shows_fields_and_fills_value", async () => {
    // Scenario (task 153): prefilling with a stored per-project override unhides the task-136
    // fields and fills the input with the override.
    // Steps:
    // boot the DOM and run initializeHeader (reported derived dir = /tmp/file-history).
    await initializeHeaderInFreshDom();
    const { prefillFileHistoryOverrideField } = await import("../webapp/app-header.ts");
    // prefill with a stored per-project override.
    prefillFileHistoryOverrideField("/overrides/fh");
    // the fields are visible and carry the override.
    assert.equal(getRequiredElementById("file-history-fields").hidden, false);
    assert.equal((getRequiredElementById("file-history-dir-input") as HTMLInputElement).value, "/overrides/fh");
    // clear the prefill so the module state ends in the derived state for later tests.
    prefillFileHistoryOverrideField(undefined);
});

test("test_prefill_without_override_restores_derived_state_after_a_prefill", async () => {
    // Scenario (task 153): a project WITHOUT a stored override restores the derived state, so a
    // prior project's prefill never leaks into the next project's popover.
    // Steps:
    // boot the DOM, prefill for a project with a stored override...
    await initializeHeaderInFreshDom();
    const { prefillFileHistoryOverrideField } = await import("../webapp/app-header.ts");
    prefillFileHistoryOverrideField("/overrides/fh");
    // ...then refresh for a project with no stored override.
    prefillFileHistoryOverrideField(undefined);
    // the fields hide again and the input shows the server-reported derived dir.
    assert.equal(getRequiredElementById("file-history-fields").hidden, true);
    assert.equal((getRequiredElementById("file-history-dir-input") as HTMLInputElement).value, "/tmp/file-history");
});

test("test_prefill_without_override_leaves_manual_gesture_alone", async () => {
    // Scenario (task 153): with NO prefill active, the no-override call must not clobber the
    // user's manual task-136 explicit-override gesture (fields toggled open, value typed).
    // Steps:
    // boot the DOM, open the fields via the toggle and type a value — no prefill anywhere.
    await initializeHeaderInFreshDom();
    const { prefillFileHistoryOverrideField } = await import("../webapp/app-header.ts");
    getRequiredElementById("file-history-toggle").click();
    (getRequiredElementById("file-history-dir-input") as HTMLInputElement).value = "/typed/by/user";
    // a no-override refresh runs (popover opened on a project without a stored entry).
    prefillFileHistoryOverrideField(undefined);
    // the manual gesture survives untouched.
    assert.equal(getRequiredElementById("file-history-fields").hidden, false);
    assert.equal((getRequiredElementById("file-history-dir-input") as HTMLInputElement).value, "/typed/by/user");
});

test("test_apply_posts_empty_file_history_when_value_is_unedited_prefill", async () => {
    // Scenario (task 153): an UNEDITED prefilled per-project override posts "" (= re-derive)
    // through the GLOBAL "Change folder" button — it must not silently become a global override.
    // Steps:
    // boot the DOM and prefill the per-project override.
    await initializeHeaderInFreshDom();
    const { prefillFileHistoryOverrideField } = await import("../webapp/app-header.ts");
    prefillFileHistoryOverrideField("/overrides/fh");
    const recordedCalls = recordFetchCalls();
    // apply the GLOBAL folder change with the prefill untouched.
    getRequiredElementById("projects-dir-change").click();
    await flushAsyncWork();
    // the POST body carries the empty derive marker, not the per-project override.
    assert.equal(getRecordedConfigPostBody(recordedCalls).fileHistoryDir, "");
    // clear the prefill so the module state ends in the derived state.
    prefillFileHistoryOverrideField(undefined);
});

test("test_paths_popover_stays_open_on_inside_click", async () => {
    // Scenario: clicks inside the paths popover (typing in the inputs) stop propagation so the
    // document-level closer never fires; only the apply button lets its click through.
    // Steps:
    // boot the DOM and run initializeHeader.
    await initializeHeaderInFreshDom();
    const pathsPopover = getRequiredElementById("paths-popover");
    // open the popover via its toolbar button.
    getRequiredElementById("paths-btn").click();
    assert.equal(pathsPopover.hidden, false);
    // click an inside element that is NOT the apply button (#projects-dir-change).
    getRequiredElementById("projects-dir-input").click();
    // assert the popover stayed open.
    assert.equal(pathsPopover.hidden, false);
});
