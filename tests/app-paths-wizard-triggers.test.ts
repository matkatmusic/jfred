// Task 159: the Paths wizard's Cancel and auto-run triggers; each test uses a UNIQUE project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initWebappDom } from "./webapp-dom-test-helpers.ts";
import { stubFetchRoutes } from "./webapp-fetch-test-helpers.ts";

const TIP_COMMIT_HASH = "c".repeat(40);

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

// Boot a fresh DOM with the routes the wizard touches stubbed, run the header bootstrap (fills the folder inputs), and wire the wizard listeners.
async function initializeWizardInFreshDom(projectPathsEntry: unknown): Promise<typeof import("../webapp/app-paths-wizard.ts")> {
    initWebappDom();
    stubFetchRoutes({
        "/api/config": { projectsDir: "/tmp/projects", fileHistoryDir: "/tmp/file-history", bootId: "boot-1" },
        "/api/projects": [],
        "/api/project-paths": projectPathsEntry,
        "/api/repo-commits": [{ hash: TIP_COMMIT_HASH, date: "2026-07-22", subject: "tip commit" }],
        "/api/repo-commit-match": { matchedCount: 4, totalCount: 4 },
    });
    const { initializeHeader } = await import("../webapp/app-header.ts");
    await initializeHeader();
    const wizardModule = await import("../webapp/app-paths-wizard.ts");
    wizardModule.initializeWizard();
    return wizardModule;
}

test("test_cancel_abandons_run_with_nothing_posted", async () => {
    // Scenario (mockup): Cancel closes the popover and posts nothing at all.
    const wizard = await initializeWizardInFreshDom({ repo: "/repos/p" });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-cancel");
    wizard.startProjectWizard("proj-cancel");
    const recordedCalls = recordFetchCalls();
    getRequiredElementById("wizard-cancel").click();
    await waitForAsyncWork();
    assert.equal(getRequiredElementById("paths-popover").hidden, true);
    const posts = recordedCalls.filter((call) => call.init?.method === "POST");
    assert.equal(posts.length, 0);
});

test("test_project_load_with_no_entry_offers_screens_2_to_5", async () => {
    // Scenario (mockup trigger): a project loading with NO reveng-paths entry auto-opens the wizard at screen 2; a configured project does not.
    await initializeWizardInFreshDom({});
    const { maybeOfferProjectPathsWizard } = await import("../webapp/app-paths-project.ts");
    await maybeOfferProjectPathsWizard("proj-offer");
    assert.equal(getRequiredElementById("paths-popover").hidden, false);
    assert.equal(getRequiredElementById("wizard-screen-2").hidden, false);
    // a configured project (fresh DOM, stored repo) gets no auto-run.
    await initializeWizardInFreshDom({ repo: "/repos/p" });
    const reimported = await import("../webapp/app-paths-project.ts");
    await reimported.maybeOfferProjectPathsWizard("proj-offer-configured");
    assert.equal(getRequiredElementById("paths-popover").hidden, true);
});

test("test_first_launch_with_empty_projects_dir_starts_full_wizard", async () => {
    // Scenario (mockup trigger): no global config leaves the projects-dir input empty at boot — the full wizard starts at screen 1 (screen-1-only run without a project: Next is Finish).
    initWebappDom();
    stubFetchRoutes({});
    const wizard = await import("../webapp/app-paths-wizard.ts");
    wizard.initializeWizard();
    wizard.maybeStartFirstLaunchWizard();
    assert.equal(getRequiredElementById("paths-popover").hidden, false);
    assert.equal(getRequiredElementById("wizard-screen-1").hidden, false);
    assert.equal(getRequiredElementById("wizard-next").textContent, "Finish ▸");
});
