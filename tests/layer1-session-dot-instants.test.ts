// Task 907: the page store and loader for every session's dot instants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";
import {
    buildSessionDotInstantsUrl,
    clearSessionDotInstants,
    loadSessionDotInstants,
    readRequiredSessionDotInstants,
    readSessionDotInstants,
    storeSessionDotInstants,
} from "../webapp/layer1-components/session-column/layer1-session-dot-instants.ts";

const INSTANTS_PATHNAME = "/api/layer1-session-dot-instants";
const REQUEST = { dir: "/work", jsonlFolders: ["/logs/a", "/logs/b"] };
const WIRE_ANSWER = {
    sessions: [
        { sessionId: "a", deltasMs: [100, 5, 0, 20] },
        { sessionId: "b", deltasMs: [7] },
    ],
};

function installFailingInstantsFetch(status: number): void {
    const failingFetch = async (): Promise<Response> => ({ ok: false, status } as unknown as Response);
    Object.assign(globalThis, { fetch: failingFetch });
}

test("test_loading_stores_the_decoded_instants", async () => {
    // Scenario: a load turns the delta answer into ascending instants per session.
    // Start from a cleared store.
    clearSessionDotInstants();
    // The server answers with two sessions as delta milliseconds.
    installFetchRoutes({ [INSTANTS_PATHNAME]: WIRE_ANSWER });
    // Load the instants.
    await loadSessionDotInstants(REQUEST);
    // The store holds the running sums, equal instants kept.
    const expected = new Map([["a", [100, 105, 105, 125]], ["b", [7]]]);
    assert.deepEqual(readSessionDotInstants(), expected);
});

test("test_reading_before_any_load_gives_nothing", () => {
    // Scenario: an empty store reads as undefined.
    // Start from a cleared store.
    clearSessionDotInstants();
    // Reading gives nothing.
    assert.equal(readSessionDotInstants(), undefined);
});

test("test_requiring_before_any_load_throws", () => {
    // Scenario: asking for instants that were never loaded is a loud error.
    // Start from a cleared store.
    clearSessionDotInstants();
    // The required read throws and names the problem.
    assert.throws(() => readRequiredSessionDotInstants(), /session dot instants are not loaded/);
});

test("test_clearing_forgets_the_instants", () => {
    // Scenario: clearing drops what was stored.
    // Start from a cleared store, then store one session.
    clearSessionDotInstants();
    storeSessionDotInstants(new Map([["a", [1, 2]]]));
    // The stored instants are readable.
    assert.deepEqual(readRequiredSessionDotInstants(), new Map([["a", [1, 2]]]));
    // Clear the store.
    clearSessionDotInstants();
    // The read gives nothing again.
    assert.equal(readSessionDotInstants(), undefined);
});

test("test_the_instants_url_carries_the_dir_and_every_jsonl_folder", () => {
    // Scenario: the ask uses the same query shape as the session dots ask, without from and to.
    // Start from a cleared store.
    clearSessionDotInstants();
    // Build the url for a request with two jsonl folders.
    const url = new URL(buildSessionDotInstantsUrl(REQUEST), "http://localhost:7343");
    // The path is the instants route.
    assert.equal(url.pathname, INSTANTS_PATHNAME);
    // The dir is carried once.
    assert.deepEqual(url.searchParams.getAll("dir"), ["/work"]);
    // Every jsonl folder is carried, in order.
    assert.deepEqual(url.searchParams.getAll("jsonl"), ["/logs/a", "/logs/b"]);
    // No time range is asked.
    assert.equal(url.searchParams.has("from"), false);
    assert.equal(url.searchParams.has("to"), false);
});

test("test_a_failed_load_throws", async () => {
    // Scenario: a server error is a loud error and stores nothing.
    // Start from a cleared store.
    clearSessionDotInstants();
    // The server answers status 500.
    installFailingInstantsFetch(500);
    // The load rejects and names the status.
    await assert.rejects(() => loadSessionDotInstants(REQUEST), /session dot instants ask failed: 500/);
    // Nothing was stored.
    assert.equal(readSessionDotInstants(), undefined);
});
