// loadReverseWalk fetches /api/layer1-reverse for one path, remembers the answer in the store, and shows the same loading UI as the Edit box.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";

initLayer1Dom();
const { loadReverseWalk } = await import("../webapp/layer1-reverse-load.ts");
const { clearReverseWalks, readReverseWalk } = await import("../webapp/layer1-reverse-store.ts");
const { stopLayer1Load } = await import("../webapp/layer1-components/loading-bar/layer1-progress.ts");
const { writeSourcePaths } = await import("../webapp/layer1-components/top-bars/layer1-source-paths.ts");

const WALK = { path: "src/run.ts", states: [{ index: 0, kind: "DiskNow", content: "now" }] };
const PROGRESS = { kind: "progress", label: "walking back", current: 1, total: 2 };

function openPageWithSources(): void {
    initLayer1Dom();
    clearReverseWalks();
    (document.getElementById("dir") as HTMLInputElement).value = "/w";
    writeSourcePaths(SourceKind.jsonl, ["/t/one", "/t/two"]);
    writeSourcePaths(SourceKind.fileHistory, []);
}

function recordFetchedUrls(): string[] {
    const urls: string[] = [];
    const inner = globalThis.fetch;
    Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
        urls.push(String(url));
        return inner(url as string, init);
    } });
    return urls;
}

test("test_loadReverseWalk_asks_with_dir_every_jsonl_path_and_progress", async () => {
    // Scenario: the request carries exactly the project folder, every transcripts folder in order, the path and progress=1.
    openPageWithSources();
    installStreamRoute("/api/layer1-reverse", [WALK]);
    const urls = recordFetchedUrls();
    await loadReverseWalk("src/run.ts");
    const params = new URL(urls[0]!, "http://localhost:7343").searchParams;
    assert.equal(new URL(urls[0]!, "http://localhost:7343").pathname, "/api/layer1-reverse");
    assert.deepEqual([...params.keys()].sort(), ["dir", "jsonl", "jsonl", "path", "progress"]);
    assert.equal(params.get("dir"), "/w");
    assert.deepEqual(params.getAll("jsonl"), ["/t/one", "/t/two"]);
    assert.equal(params.get("path"), "src/run.ts");
    assert.equal(params.get("progress"), "1");
});

test("test_loadReverseWalk_asks_with_every_snapshots_path", async () => {
    // Scenario: the page holds two file-history folders; the request carries both, in order.
    openPageWithSources();
    writeSourcePaths(SourceKind.fileHistory, ["/h/one", "/h/two"]);
    installStreamRoute("/api/layer1-reverse", [WALK]);
    const urls = recordFetchedUrls();
    await loadReverseWalk("src/run.ts");
    const params = new URL(urls[0]!, "http://localhost:7343").searchParams;
    assert.deepEqual(params.getAll("snapshots"), ["/h/one", "/h/two"]);
});

test("test_loadReverseWalk_returns_the_walk_and_stores_it", async () => {
    // Scenario: after a successful load the caller gets the walk and the store holds it under its path.
    openPageWithSources();
    installStreamRoute("/api/layer1-reverse", [PROGRESS, WALK]);
    assert.deepEqual(await loadReverseWalk("src/run.ts"), WALK);
    assert.deepEqual(readReverseWalk("src/run.ts"), WALK);
});

test("test_loadReverseWalk_closes_the_shield_and_hides_the_loadbar_after_success", async () => {
    // Scenario: when the walk arrives, the busy shield and the loadbar are both hidden.
    openPageWithSources();
    installStreamRoute("/api/layer1-reverse", [PROGRESS, WALK]);
    await loadReverseWalk("src/run.ts");
    assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), true);
    assert.equal(document.getElementById("loadbar")!.hasAttribute("hidden"), true);
});

test("test_loadReverseWalk_opens_the_shield_before_the_first_await", async () => {
    // Scenario: the shield is already visible when the function returns its promise.
    openPageWithSources();
    installStreamRoute("/api/layer1-reverse", [WALK]);
    const loading = loadReverseWalk("src/run.ts");
    assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), false);
    await loading;
});

test("test_a_cancelled_load_closes_the_shield_stores_nothing_and_rejects", async () => {
    // Scenario: the user presses cancel; the shield closes, the loadbar hides, the store stays empty, and the promise rejects.
    openPageWithSources();
    Object.assign(globalThis, { fetch: async () => {
        stopLayer1Load();
        throw new Error("aborted");
    } });
    await assert.rejects(loadReverseWalk("src/run.ts"), /cancelled/);
    assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), true);
    assert.equal(document.getElementById("loadbar")!.hasAttribute("hidden"), true);
    assert.equal(readReverseWalk("src/run.ts"), undefined);
});

test("test_a_failed_fetch_shows_the_error_on_the_shield_and_rejects", async () => {
    // Scenario: a server error shows its text on the shield, hides the loadbar, stores nothing, and the promise rejects.
    openPageWithSources();
    Object.assign(globalThis, { fetch: async () => ({ ok: false, status: 500, text: async () => "boom" }) });
    await assert.rejects(loadReverseWalk("src/run.ts"), /boom/);
    assert.equal(document.getElementById("busy-shield")!.hasAttribute("hidden"), false);
    assert.match(document.getElementById("busy-error")!.textContent!, /boom/);
    assert.equal(document.getElementById("loadbar")!.hasAttribute("hidden"), true);
    assert.equal(readReverseWalk("src/run.ts"), undefined);
});
