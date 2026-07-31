// Task 332: File Nav folder collapse state seeds from the saved project and persists on toggle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById } from "../webapp/app-dom.ts";
import { restoreSavedSettings } from "../webapp/layer1-settings.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// el() needs a document.
setupLayer1Dom();

// "src" is the common prefix buildFileTree strips, leaving "nested" and "other" as sibling root folders.
const NAV_VIEW = {
    pairs: [
        { path: "src/nested/kept.ts", commits: [] },
        { path: "src/other/thing.ts", commits: [] },
    ],
    gitOrphans: [],
    diskOrphans: [],
};

function respondWith(body: unknown, ok: boolean): Response {
    return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => "" } as unknown as Response;
}

// Records every POST body; answers GET with `savedFile`.
function stubSettingsRoute(savedFile: unknown): { posted: () => unknown[] } {
    const posted: unknown[] = [];
    const answer = async (_url: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
        if (init?.method !== "POST") {
            return respondWith(savedFile, true);
        }
        posted.push(JSON.parse(init.body ?? "{}"));
        return respondWith({ saved: true }, true);
    };
    Object.assign(globalThis, { fetch: answer });
    return { posted: () => posted };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function findDetailsNamed(container: HTMLElement, name: string): HTMLDetailsElement {
    const summary = [...container.querySelectorAll("summary.file-folder-name")]
        .find((candidate) => candidate.textContent === name);
    assert.ok(summary !== undefined, `no File Nav folder named ${name}`);
    return (summary as HTMLElement).parentElement as HTMLDetailsElement;
}

test("test_a_projects_saved_collapsed_folders_render_closed_on_load", async () => {
    const { renderLayer1FileNav } = await import("../webapp/layer1-filenav.ts");
    const dir = "/tmp/nav-project-a";
    stubSettingsRoute({
        lastDir: dir,
        projects: { [dir]: { dir, repo: dir, branch: "main", ref: "", jsonl: [], fileHistory: [], collapsedFolders: ["nested"] } },
    });
    await restoreSavedSettings();

    renderLayer1FileNav(NAV_VIEW, () => {});

    const tree = document.getElementById("filenav-tree") as HTMLElement;
    assert.ok(!findDetailsNamed(tree, "nested").hasAttribute("open"));
    assert.ok(findDetailsNamed(tree, "other").hasAttribute("open"));
});

test("test_collapsing_a_folder_persists_it_for_the_current_project", async () => {
    const { renderLayer1FileNav } = await import("../webapp/layer1-filenav.ts");
    const dir = "/tmp/nav-project-b";
    getInputById("dir").value = dir;
    const route = stubSettingsRoute(null);

    renderLayer1FileNav(NAV_VIEW, () => {});
    const tree = document.getElementById("filenav-tree") as HTMLElement;
    const nested = findDetailsNamed(tree, "nested");
    nested.open = false;
    await settle();

    assert.deepEqual(route.posted(), [{ dir, collapsedFolders: ["nested"] }]);
});

test("test_a_collapsed_folder_survives_a_search_box_rerender", async () => {
    const { renderLayer1FileNav } = await import("../webapp/layer1-filenav.ts");
    getInputById("dir").value = "/tmp/nav-project-c";
    stubSettingsRoute(null);

    renderLayer1FileNav(NAV_VIEW, () => {});
    const tree = document.getElementById("filenav-tree") as HTMLElement;
    const nested = findDetailsNamed(tree, "nested");
    nested.open = false;

    // Both files must survive the filter, or the stripped common prefix leaves no folders to assert on.
    const searchBox = document.getElementById("filenav-search") as HTMLInputElement;
    searchBox.value = ".ts";
    searchBox.dispatchEvent(new window.Event("input"));

    assert.ok(!findDetailsNamed(tree, "nested").hasAttribute("open"));
});
