import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initWebappDom } from "./webapp-dom-test-helpers.ts";
import { stubFetchRoutes } from "./webapp-fetch-test-helpers.ts";

// The dynamic import keeps every webapp module load AFTER the globals exist.
async function initHeaderInFreshDom(): Promise<void> {
    initWebappDom();
    stubFetchRoutes({
        "/api/config": { projectsDir: "/tmp/projects", fileHistoryDir: "/tmp/file-history", bootId: "boot-1" },
        "/api/projects": [{ name: "proj-a" }, { name: "proj-b" }],
    });
    const { initHeader } = await import("../webapp/app-header.ts");
    await initHeader();
}

// The element with `id`, asserted present — a missing id fails the test naming the id.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

test("test_initHeader_fills_folder_inputs_from_config", async () => {
    // Scenario: initHeader mirrors the /api/config folders into the two Paths inputs.  Steps: boot the DOM, run initHeader.
    await initHeaderInFreshDom();
    // assert both folder inputs carry the stubbed config values.
    assert.equal((getRequiredElementById("projects-dir-input") as HTMLInputElement).value, "/tmp/projects");
    assert.equal((getRequiredElementById("file-history-dir-input") as HTMLInputElement).value, "/tmp/file-history");
});

test("test_projects_button_opens_menu_and_document_click_closes_it", async () => {
    // Scenario: the Projects button opens its menu, one row per project; a document click closes it.
    await initHeaderInFreshDom();
    const projectsMenu = getRequiredElementById("projects-menu");
    // the menu starts hidden (index.html markup).
    assert.equal(projectsMenu.hidden, true);
    // click the Projects button: the popover opens despite the document-level closer.
    getRequiredElementById("projects-btn").click();
    assert.equal(projectsMenu.hidden, false);
    // the fire-and-forget populate settles: one .menu-item per stubbed project, in order.
    await waitForAsyncWork();
    const menuItems = [...projectsMenu.querySelectorAll(".menu-item")];
    assert.deepEqual(menuItems.map((item) => item.textContent), ["proj-a", "proj-b"]);
    // a plain document-level click closes both popovers.
    document.body.click();
    assert.equal(projectsMenu.hidden, true);
    assert.equal(getRequiredElementById("paths-popover").hidden, true);
});

// task 136: hidden file-history field means "derive from the projects folder", so the POST carries "".

// Wraps the stubbed fetch with a recorder so a test can inspect POST bodies.
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
    // Scenario (task 136): the file-history field starts hidden; the toggle button shows and hides it.
    await initHeaderInFreshDom();
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
    // Scenario (task 136): hidden fields mean the apply POST carries "" even if the input has text.
    await initHeaderInFreshDom();
    (getRequiredElementById("file-history-dir-input") as HTMLInputElement).value = "/tmp/should-not-post";
    const recordedCalls = recordFetchCalls();
    // apply the folder change.
    getRequiredElementById("projects-dir-change").click();
    await waitForAsyncWork();
    // the POST body carries the empty derive marker, not the hidden text.
    assert.equal(getRecordedConfigPostBody(recordedCalls).fileHistoryDir, "");
});

test("test_apply_posts_edited_file_history_when_fields_shown", async () => {
    // Scenario (task 136): showing the fields is the explicit-override gesture, so an edited value posts.
    await initHeaderInFreshDom();
    getRequiredElementById("file-history-toggle").click();
    (getRequiredElementById("file-history-dir-input") as HTMLInputElement).value = "/tmp/custom-history";
    const recordedCalls = recordFetchCalls();
    // apply the folder change.
    getRequiredElementById("projects-dir-change").click();
    await waitForAsyncWork();
    // the POST body carries the edited override.
    assert.equal(getRecordedConfigPostBody(recordedCalls).fileHistoryDir, "/tmp/custom-history");
});

test("test_paths_popover_stays_open_on_inside_click", async () => {
    // Scenario: inside clicks on the paths popover stop propagation; only the apply button lets its click through.
    await initHeaderInFreshDom();
    const pathsPopover = getRequiredElementById("paths-popover");
    // open the popover via its toolbar button.
    getRequiredElementById("paths-btn").click();
    assert.equal(pathsPopover.hidden, false);
    // click an inside element that is NOT the apply button (#projects-dir-change).
    getRequiredElementById("projects-dir-input").click();
    // assert the popover stayed open.
    assert.equal(pathsPopover.hidden, false);
});
