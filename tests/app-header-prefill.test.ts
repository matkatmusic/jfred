// Task 153: a per-project file-history prefill must never leak into the global header state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initWebappDom } from "./webapp-dom-test-helpers.ts";
import { stubFetchRoutes } from "./webapp-fetch-test-helpers.ts";

// The dynamic import keeps every webapp module load AFTER the globals exist.
async function initializeHeaderInFreshDom(): Promise<void> {
    initWebappDom();
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

test("test_prefill_with_override_shows_fields_and_fills_value", async () => {
    // Task 153: a stored per-project override unhides the fields and fills the input.
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
    // Scenario (task 153): a project WITHOUT a stored override restores the derived state, so a prior project's prefill never leaks into the next project's popover.  Steps: boot the DOM, prefill for a project with a stored override...
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
    // Scenario (task 153): with NO prefill active, the no-override call must not clobber the user's manual task-136 explicit-override gesture (fields toggled open, value typed).  Steps: boot the DOM, open the fields via the toggle and type a value — no prefill anywhere.
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
    // Scenario (task 153): an UNEDITED prefilled per-project override posts "" (= re-derive) through the GLOBAL "Change folder" button — it must not silently become a global override.  Steps: boot the DOM and prefill the per-project override.
    await initializeHeaderInFreshDom();
    const { prefillFileHistoryOverrideField } = await import("../webapp/app-header.ts");
    prefillFileHistoryOverrideField("/overrides/fh");
    const recordedCalls = recordFetchCalls();
    // apply the GLOBAL folder change with the prefill untouched.
    getRequiredElementById("projects-dir-change").click();
    await waitForAsyncWork();
    // the POST body carries the empty derive marker, not the per-project override.
    assert.equal(getRecordedConfigPostBody(recordedCalls).fileHistoryDir, "");
    // clear the prefill so the module state ends in the derived state.
    prefillFileHistoryOverrideField(undefined);
});
