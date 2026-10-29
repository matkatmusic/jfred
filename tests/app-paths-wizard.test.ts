// DOM tests for app-paths-wizard.ts (task 159); module state persists, so each test uses a UNIQUE project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initWebappDom } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";

const TIP_COMMIT_HASH = "c".repeat(40);

// The element with `id`, asserted present — a missing id fails the test naming the id.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

function getInput(id: string): HTMLInputElement {
    return getRequiredElementById(id) as HTMLInputElement;
}

// Wrap the stubbed fetch with a recorder so tests can inspect POST bodies (app-header.test.ts pattern).
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

// Boot a fresh DOM with the wizard's routes stubbed, run the header bootstrap, wire the wizard listeners.
async function initializeWizardInFreshDom(projectPathsEntry: unknown): Promise<typeof import("../webapp/app-paths-wizard.ts")> {
    initWebappDom();
    installFetchRoutes({
        "/api/config": { projectsDir: "/tmp/projects", fileHistoryDir: "/tmp/file-history", bootId: "boot-1" },
        "/api/projects": [],
        "/api/project-paths": projectPathsEntry,
        "/api/repo-commits": [{ hash: TIP_COMMIT_HASH, date: "2026-07-22", subject: "tip commit" }],
        "/api/repo-commit-match": { matchedCount: 4, totalCount: 4 },
    });
    const { initHeader } = await import("../webapp/app-header.ts");
    await initHeader();
    const wizardModule = await import("../webapp/app-paths-wizard.ts");
    wizardModule.initializeWizard();
    return wizardModule;
}

test("test_paths_button_shows_summary_default_face_with_global_rows", async () => {
    // Scenario: on a non-project route, Paths… opens the summary with two GLOBAL rows and no wizard screen.
    await initializeWizardInFreshDom({});
    getRequiredElementById("paths-btn").click();
    assert.equal(getRequiredElementById("paths-popover").hidden, false);
    assert.equal(getRequiredElementById("paths-summary").hidden, false);
    assert.equal(getRequiredElementById("wizard-screen-1").hidden, true);
    assert.equal(getRequiredElementById("wizard-nav").hidden, true);
    const rows = [...getRequiredElementById("paths-summary-rows").querySelectorAll(".summary-row")];
    assert.equal(rows.length, 2);
    // the projects-folder row carries the config value the header loaded.
    assert.ok(rows[0]!.textContent!.includes("/tmp/projects"));
    assert.ok(rows[1]!.textContent!.includes("auto-derived"));
});

test("test_summary_edit_opens_single_screen_whose_next_is_finish", async () => {
    // Scenario (mockup §b): the Git repo row's [Edit] opens screen 3 alone, Back disabled, Next is Finish.
    await initializeWizardInFreshDom({ repo: "/repos/p" });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-edit");
    const rows = [...getRequiredElementById("paths-summary-rows").querySelectorAll(".summary-row")];
    assert.equal(rows.length, 5);
    (rows[2]!.querySelector(".summary-edit") as HTMLElement).click();
    assert.equal(getRequiredElementById("paths-popover").hidden, false);
    assert.equal(getRequiredElementById("wizard-screen-3").hidden, false);
    assert.equal(getRequiredElementById("paths-summary").hidden, true);
    assert.equal(getRequiredElementById("wizard-nav").hidden, false);
    assert.equal((getRequiredElementById("wizard-back") as HTMLButtonElement).disabled, true);
    assert.equal(getRequiredElementById("wizard-next").textContent, "Finish ▸");
    // the screen prefilled "Yes" from the non-empty repo field.
    assert.equal(getInput("wizard-repo-yes").checked, true);
});

test("test_screen3_answered_no_skips_4_and_5_and_clears_repo_fields", async () => {
    // Scenario (mockup flow): choosing "No" on screen 3 jumps to Finish and clears repo and base commit.
    const wizard = await initializeWizardInFreshDom({ repo: "/repos/p", baseCommit: TIP_COMMIT_HASH });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-skip");
    wizard.startProjectWizard("proj-skip");
    // screen 2 (first of the project run), then Next to screen 3.
    assert.equal(getRequiredElementById("wizard-screen-2").hidden, false);
    getRequiredElementById("wizard-next").click();
    assert.equal(getRequiredElementById("wizard-screen-3").hidden, false);
    // answer "No" and advance: Finish face, screens 4 and 5 skipped.
    getInput("wizard-repo-yes").checked = false;
    getInput("wizard-repo-no").checked = true;
    getRequiredElementById("wizard-next").click();
    assert.equal(getRequiredElementById("wizard-finish").hidden, false);
    assert.equal(getRequiredElementById("wizard-screen-4").hidden, true);
    assert.equal(getRequiredElementById("wizard-screen-5").hidden, true);
    assert.equal(getInput("repo-dir-input").value, "");
    assert.equal(getInput("base-commit-display").value, "");
});

test("test_full_project_run_finish_stores_mirror_and_posts_preBaseline", async () => {
    // Scenario: screens 2→3(yes)→4→5(yes)→Finish; "Apply to session only" stores the task-56 mirror BEFORE the POST; popover closes.
    const wizard = await initializeWizardInFreshDom({ repo: "/repos/p" });
    const { refreshProjectPathsSection } = await import("../webapp/app-paths-project.ts");
    await refreshProjectPathsSection("proj-full");
    wizard.startProjectWizard("proj-full");
    getRequiredElementById("wizard-next").click();   // 2 → 3 (yes prefilled: repo present)
    getRequiredElementById("wizard-next").click();   // 3 → 4
    assert.equal(getRequiredElementById("wizard-screen-4").hidden, false);
    // no stored base commit → the Default radio is preselected and the tip label resolves.
    assert.equal(getInput("wizard-commit-default").checked, true);
    await waitForAsyncWork();
    const defaultLabel = getRequiredElementById("wizard-commit-default-label").textContent!;
    assert.ok(defaultLabel.includes(TIP_COMMIT_HASH.slice(0, 12)), `tip label resolved: ${defaultLabel}`);
    assert.ok(defaultLabel.includes("repo tip"), defaultLabel);
    getRequiredElementById("wizard-next").click();   // 4 → 5
    assert.equal(getRequiredElementById("wizard-screen-5").hidden, false);
    assert.equal(getRequiredElementById("wizard-next").textContent, "Finish ▸");
    getInput("wizard-prebaseline-no").checked = false;
    getInput("wizard-prebaseline-yes").checked = true;
    getRequiredElementById("wizard-next").click();   // 5 → Finish face
    assert.equal(getRequiredElementById("wizard-finish").hidden, false);
    const recordedCalls = recordFetchCalls();
    getRequiredElementById("project-paths-apply").click();
    await waitForAsyncWork();
    // the mirror was stored, and the POSTed entry carries it (Store would persist it).
    assert.equal(sessionStorage.getItem("baseline:proj-full"), "1");
    const pathsPost = recordedCalls.find((call) => call.url.includes("/api/project-paths") && call.init?.method === "POST");
    assert.ok(pathsPost !== undefined, "a POST to /api/project-paths was recorded");
    const body = JSON.parse(String(pathsPost!.init!.body)) as { entry: { repo?: string; preBaseline?: string } };
    assert.equal(body.entry.preBaseline, "1");
    assert.equal(body.entry.repo, "/repos/p");
    assert.equal(getRequiredElementById("paths-popover").hidden, true);
});
