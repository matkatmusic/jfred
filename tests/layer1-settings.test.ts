// Task 297: the Save-project-settings button and the restore that reads its file back.
//
// Two rules carry the risk. A FAILED save must leave the button armed — a page that reports "saved"
// when nothing was written is worse than one that never saves. And a ?dir=/?repo= link must beat the
// saved file, or a shared link silently renders somebody else's project.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { markSettingsDirty, restoreSavedSettings, wireSettingsSave } from "../webapp/layer1-settings.ts";
import { readSourcePaths, SourceKind, writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

const SAVED_PROJECT = {
    dir: "/Users/you/code/demo-app",
    repo: "/Users/you/code/demo-app",
    branch: "main",
    ref: "",
    jsonl: ["/Users/you/.claude/projects/-Users-you-code-demo-app"],
    fileHistory: ["/Users/you/.claude/file-history"],
};

function respondWith(body: unknown, ok: boolean, text: string): Response {
    return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => text } as unknown as Response;
}

// Records every POST body so the save's payload can be asserted, and answers GET with `savedFile`.
function stubSettingsRoute(savedFile: unknown, saveSucceeds: boolean): { posted: () => unknown[] } {
    const posted: unknown[] = [];
    const answer = async (_url: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
        if (init?.method !== "POST") {
            return respondWith(savedFile, true, "");
        }
        posted.push(JSON.parse(init.body ?? "{}"));
        return respondWith({ saved: saveSucceeds }, saveSucceeds, "disk full");
    };
    Object.assign(globalThis, { fetch: answer });
    return { posted: () => posted };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function isSaveButtonDisabled(): boolean {
    return (getRequiredElementById("save-settings") as HTMLButtonElement).disabled;
}

test("editing a saved field arms the button and drops the stale note", () => {
    setupLayer1Dom();
    stubSettingsRoute(null, true);
    wireSettingsSave();
    getRequiredElementById("saved-note").textContent = "saved";
    assert.equal(isSaveButtonDisabled(), true);

    getInputById("repo").dispatchEvent(new window.Event("input", { bubbles: true }));

    assert.equal(isSaveButtonDisabled(), false);
    assert.equal(getRequiredElementById("saved-note").textContent, "");
});

test("a successful save posts the whole record and disarms the button", async () => {
    setupLayer1Dom();
    const route = stubSettingsRoute(null, true);
    wireSettingsSave();
    getInputById("dir").value = SAVED_PROJECT.dir;
    getInputById("repo").value = SAVED_PROJECT.repo;
    markSettingsDirty();

    getRequiredElementById("save-settings").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();

    assert.equal(route.posted().length, 1);
    assert.deepEqual(Object.keys(route.posted()[0] as object).sort(),
        ["branch", "dir", "fileHistory", "jsonl", "ref", "repo"]);
    assert.equal(isSaveButtonDisabled(), true);
    assert.equal(getRequiredElementById("saved-note").textContent, "saved");
});

test("a refused save leaves the button armed and says so", async () => {
    setupLayer1Dom();
    stubSettingsRoute(null, false);
    wireSettingsSave();
    markSettingsDirty();

    getRequiredElementById("save-settings").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();

    assert.equal(isSaveButtonDisabled(), false);
    assert.match(getRequiredElementById("saved-note").textContent ?? "", /save failed/);
});

test("the saved file fills the boxes and the two source lists", async () => {
    setupLayer1Dom();
    stubSettingsRoute({ lastDir: SAVED_PROJECT.dir, projects: { [SAVED_PROJECT.dir]: SAVED_PROJECT } }, true);

    assert.equal(await restoreSavedSettings(), true);

    assert.equal(getInputById("dir").value, SAVED_PROJECT.dir);
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], SAVED_PROJECT.jsonl);
    assert.deepEqual([...readSourcePaths(SourceKind.fileHistory)], SAVED_PROJECT.fileHistory);
});

test("a link wins for the fields it names, and only those", async () => {
    // Precedence is PER FIELD. A ?dir=&repo= link must render what it names — but it says nothing
    // about the source lists, and blanking the whole restore over it is what left the headless
    // harness, which always navigates with a query string, on one derived JSONL folder.
    setupLayer1Dom("?dir=/Users/you/code/other-app&repo=/Users/you/code/other-app");
    stubSettingsRoute({ lastDir: SAVED_PROJECT.dir, projects: { [SAVED_PROJECT.dir]: SAVED_PROJECT } }, true);
    getInputById("dir").value = "/Users/you/code/other-app";

    assert.equal(await restoreSavedSettings(), true);

    assert.equal(getInputById("dir").value, "/Users/you/code/other-app");
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], SAVED_PROJECT.jsonl);
});

test("a link carrying its own source list keeps it", async () => {
    setupLayer1Dom("?dir=/Users/you/code/other-app&jsonl=%2Flinked%2Fprojects");
    stubSettingsRoute({ lastDir: SAVED_PROJECT.dir, projects: { [SAVED_PROJECT.dir]: SAVED_PROJECT } }, true);
    writeSourcePaths(SourceKind.jsonl, ["/linked/projects"]);

    await restoreSavedSettings();

    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], ["/linked/projects"]);
});

test("debugConfig defaults fill the page when nothing is saved", async () => {
    const DEFAULTS = { dir: "/cfg/project", repo: "/cfg/project", jsonl: ["/cfg/a", "/cfg/b", "/cfg/c"] };
    setupLayer1Dom();
    stubSettingsRoute({ lastDir: null, projects: {}, defaults: DEFAULTS }, true);
    writeSourcePaths(SourceKind.jsonl, []);

    assert.equal(await restoreSavedSettings(), true);

    assert.equal(getInputById("dir").value, "/cfg/project");
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], DEFAULTS.jsonl);
});

test("a saved project beats the debugConfig defaults", async () => {
    setupLayer1Dom();
    stubSettingsRoute({
        lastDir: SAVED_PROJECT.dir,
        projects: { [SAVED_PROJECT.dir]: SAVED_PROJECT },
        defaults: { dir: "/cfg/project", jsonl: ["/cfg/a"] },
    }, true);

    await restoreSavedSettings();

    assert.equal(getInputById("dir").value, SAVED_PROJECT.dir);
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], SAVED_PROJECT.jsonl);
});
