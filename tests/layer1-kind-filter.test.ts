// Task 360: the show row's boxes hide node kinds by a `.viz-root` attribute and save per project.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getInputById } from "../webapp/app-dom.ts";
import { cancelLayer1Load } from "../webapp/layer1-progress.ts";
import { setupLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
setupLayer1Dom();
const { renderLayer1Stage, renderLayer1View } = await import("../webapp/layer1-page.ts");
const { classifyNodeKind, renderShowRowWithKindFilter } = await import("../webapp/layer1-kind-filter.ts");
const { restoreSavedSettings } = await import("../webapp/layer1-settings.ts");

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const COMMIT = { ...INSTANT, hash: "b7c8d9e0f1a23445566778899aabbccddeeff001" };
const SNAPSHOT = { ...INSTANT, version: 1, sessionId: "s-1", sessionFile: "alpha.jsonl" };
const PAIR = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT, snapshots: [SNAPSHOT] };
const VIEW = { pairs: [PAIR], gitOrphans: [], diskOrphans: [], ruler: [] } as never;

// A view object nobody has loaded edits into yet; edits are remembered per view object.
function buildFreshView(): never {
    return { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] } as never;
}

function stubSettingsRoute(savedFile: unknown): { posted: () => unknown[] } {
    const posted: unknown[] = [];
    const answer = async (_url: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
        if (init?.method === "POST") {
            posted.push(JSON.parse(init.body ?? "{}"));
        }
        return { ok: true, status: 200, json: async () => savedFile, text: async () => "" } as unknown as Response;
    };
    Object.assign(globalThis, { fetch: answer });
    return { posted: () => posted };
}

async function renderFreshView(dir: string = ""): Promise<void> {
    setupLayer1Dom();
    getInputById("dir").value = dir;
    await renderLayer1View(VIEW);
}

function toggleBox(kind: string, checked: boolean): void {
    const box = document.querySelector<HTMLInputElement>(`#show-row [data-kind=${kind}]`)!;
    box.checked = checked;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function readHiddenKinds(): string {
    return document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds")!;
}

test("test_classifyNodeKind_maps_node_classes_to_show_row_kinds", () => {
    setupLayer1Dom();
    const classify = (className: string) => classifyNodeKind(el("i", { class: className }));
    assert.equal(classify("node n-disk n-created"), "created");
    assert.equal(classify("node n-commit"), "commit");
    assert.equal(classify("node n-disk"), "disk");
    assert.equal(classify("node n-snap"), "snapshot");
    assert.equal(classify("node n-edit conf-verified"), "edit");
    assert.equal(classify("node n-read conf-verified"), "edit");
    assert.equal(classify("node n-script"), "script-run");
    assert.equal(classifyNodeKind(el("li")), undefined);
    const lane = el("div", {}, [el("i", { class: "node n-commit" }), el("span", { class: "nlabel" })]);
    assert.equal(classifyNodeKind(lane.querySelector<HTMLElement>(".nlabel")!), "commit");
});

test("test_unchecking_a_box_sets_the_hidden_kinds_attribute_on_viz_root", async () => {
    await renderFreshView();
    assert.equal(readHiddenKinds(), "edit script-run");
    toggleBox("snapshot", false);
    assert.equal(readHiddenKinds(), "edit script-run snapshot");
});

test("test_unchecking_every_box_hides_every_kind", async () => {
    await renderFreshView();
    for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input")) {
        toggleBox(box.dataset["kind"]!, false);
    }
    assert.equal(readHiddenKinds(), "edit script-run commit disk snapshot");
});

test("test_rechecking_a_box_removes_its_kind_from_the_attribute", async () => {
    await renderFreshView();
    toggleBox("snapshot", false);
    toggleBox("commit", false);
    toggleBox("snapshot", true);
    assert.equal(readHiddenKinds(), "edit script-run commit");
});

test("test_ticking_the_edit_box_loads_and_redraws_once_then_later_ticks_only_flip_the_attribute", async () => {
    setupLayer1Dom();
    stubStreamRoute("/api/layer1-edits", [{ pairs: [] }]);
    let redraws = 0;
    renderShowRowWithKindFilter(buildFreshView(), () => {
        redraws += 1;
    });
    toggleBox("edit", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "script-run");
    toggleBox("edit", false);
    toggleBox("edit", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "script-run");
});

test("test_ticking_the_script_run_box_loads_and_redraws_once_then_later_ticks_only_flip_the_attribute", async () => {
    setupLayer1Dom();
    stubStreamRoute("/api/layer1-script-runs", [{ pairs: [] }]);
    let redraws = 0;
    renderShowRowWithKindFilter(buildFreshView(), () => {
        redraws += 1;
    });
    assert.equal(readHiddenKinds(), "edit script-run");
    toggleBox("script-run", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "edit");
    toggleBox("script-run", false);
    toggleBox("script-run", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "edit");
});

test("test_a_cancelled_script_run_fetch_leaves_the_box_unchecked_and_the_nodes_hidden", async () => {
    setupLayer1Dom();
    Object.assign(globalThis, { fetch: async () => {
        cancelLayer1Load();
        throw new Error("aborted");
    } });
    renderShowRowWithKindFilter(buildFreshView(), () => {});
    toggleBox("script-run", true);
    await waitForAsyncWork();
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=script-run]")!.checked, false);
    assert.equal(readHiddenKinds(), "edit script-run");
});

test("test_the_layer_4_button_ticks_the_edit_box_then_the_script_run_box_and_skips_a_box_already_on", async () => {
    setupLayer1Dom();
    stubStreamRoute("/api/layer1-edits", [{ pairs: [] }]);
    const editFetch = globalThis.fetch;
    stubStreamRoute("/api/layer1-script-runs", [{ pairs: [] }]);
    const scriptRunFetch = globalThis.fetch;
    const requested: string[] = [];
    Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
        requested.push(String(url).split("?")[0]!);
        return (String(url).includes("/api/layer1-edits") ? editFetch : scriptRunFetch)(url as string, init);
    } });
    let redraws = 0;
    renderShowRowWithKindFilter(buildFreshView(), () => {
        redraws += 1;
    });
    document.getElementById("layer-4")!.click();
    await waitForAsyncWork();
    assert.deepEqual(requested, ["/api/layer1-edits", "/api/layer1-script-runs"]);
    assert.equal(redraws, 2);
    assert.equal(readHiddenKinds(), "");
    document.getElementById("layer-4")!.click();
    await waitForAsyncWork();
    assert.equal(requested.length, 2);
});

test("test_a_cancelled_edit_fetch_leaves_the_box_unchecked_and_the_nodes_hidden", async () => {
    setupLayer1Dom();
    Object.assign(globalThis, { fetch: async () => {
        cancelLayer1Load();
        throw new Error("aborted");
    } });
    renderShowRowWithKindFilter(buildFreshView(), () => {});
    toggleBox("edit", true);
    await waitForAsyncWork();
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=edit]")!.checked, false);
    assert.equal(readHiddenKinds(), "edit script-run");
});

test("test_the_edit_box_starts_unchecked_and_is_never_saved_as_hidden", async () => {
    const route = stubSettingsRoute(null);
    await renderFreshView("/tmp/edit-app");
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=edit]")!.checked, false);
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=script-run]")!.checked, false);
    toggleBox("commit", false);
    assert.deepEqual(route.posted(), [{ dir: "/tmp/edit-app", hiddenKinds: ["commit"] }]);
});

test("test_the_attribute_survives_a_stage_redraw", async () => {
    await renderFreshView();
    toggleBox("snapshot", false);
    const staleStageBubble = document.querySelector("#stage .filebox");
    await renderLayer1Stage(VIEW);
    assert.equal(readHiddenKinds(), "edit script-run snapshot");
    assert.notEqual(document.querySelector("#stage .filebox"), staleStageBubble);
});

test("test_hiding_a_kind_never_redraws_the_stage", async () => {
    await renderFreshView();
    const bubble = document.querySelector("#stage .filebox");
    const axisPx = (bubble as HTMLElement).style.getPropertyValue("--axis-px");
    toggleBox("snapshot", false);
    assert.equal(document.querySelector("#stage .filebox"), bubble);
    assert.equal((bubble as HTMLElement).style.getPropertyValue("--axis-px"), axisPx);
});

test("test_the_boxes_restore_from_saved_settings", async () => {
    const dir = "/tmp/restore-app";
    setupLayer1Dom();
    stubSettingsRoute({ lastDir: dir, projects: { [dir]: { dir, hiddenKinds: ["snapshot"] } } });
    await restoreSavedSettings();
    await renderLayer1View(VIEW);
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=snapshot]")!.checked, false);
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=commit]")!.checked, true);
    assert.equal(readHiddenKinds(), "snapshot edit script-run");
});

test("test_toggling_a_box_posts_dir_and_hidden_kinds", async () => {
    const route = stubSettingsRoute(null);
    await renderFreshView("/tmp/post-app");
    toggleBox("commit", false);
    assert.deepEqual(route.posted(), [{ dir: "/tmp/post-app", hiddenKinds: ["commit"] }]);
    await renderFreshView("");
    toggleBox("commit", false);
    assert.equal(route.posted().length, 1);
});

test("test_the_url_never_carries_a_kinds_parameter", async () => {
    stubSettingsRoute(null);
    await renderFreshView();
    toggleBox("snapshot", false);
    assert.ok(!location.search.includes("kinds"));
});
