// Part Z: the header clear button asks first, then posts, resets the run stores and reloads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { attachClearResultsButton } from "../webapp/layer1-clear-results.ts";
import { isRunStarted, markRunStarted } from "../webapp/layer1-run-results.ts";
import { runQueueState } from "../webapp/layer1-run-route.ts";
import { addRunsToQueue } from "../webapp/layer1-run-queue.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import { buildRun, buildView, initPage, installServer, waitAndAcceptConsent, waitUntil } from "./layer1-run-queue-helpers.ts";

interface RecordedCall {
    url: string;
    method: string | undefined;
}

function installRecordingFetch(calls: RecordedCall[], isOk: boolean = true): void {
    const recordCall = async (url: unknown, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), method: init?.method });
        return { ok: isOk, status: isOk ? 200 : 500, json: async () => ({ cleared: true }) } as unknown as Response;
    };
    Object.assign(globalThis, { fetch: recordCall });
}

interface AbortProbe {
    runSignal: AbortSignal | undefined;
    wasAbortedAtPost: boolean | undefined;
}

function installAbortProbe(): AbortProbe {
    const probe: AbortProbe = { runSignal: undefined, wasAbortedAtPost: undefined };
    const serverFetch = globalThis.fetch;
    const probeFetch = async (url: unknown, init: RequestInit): Promise<Response> => {
        if (String(url) === "/api/layer1-clear-results") {
            probe.wasAbortedAtPost = probe.runSignal!.aborted;
            return { ok: true, status: 200 } as Response;
        }
        probe.runSignal = String(url).includes("layer1-script-run") ? init.signal! : probe.runSignal;
        return serverFetch(String(url), init);
    };
    Object.assign(globalThis, { fetch: probeFetch });
    return probe;
}

function clickById(id: string): void {
    document.getElementById(id)!.click();
}

function checkIsHidden(id: string): boolean {
    return document.getElementById(id)!.hasAttribute("hidden");
}

test("test_clicking_clear_shows_the_confirm_and_sends_nothing", async () => {
    initLayer1Dom();
    const calls: RecordedCall[] = [];
    installRecordingFetch(calls);
    let reloads = 0;
    attachClearResultsButton(() => { reloads += 1; });
    clickById("clear-results");
    await waitForAsyncWork();
    assert.equal(checkIsHidden("clear-results-confirm"), false);
    assert.equal(checkIsHidden("clear-results"), true);
    assert.deepEqual(calls, []);
    assert.equal(reloads, 0);
});

test("test_no_hides_the_confirm_and_sends_nothing", async () => {
    initLayer1Dom();
    const calls: RecordedCall[] = [];
    installRecordingFetch(calls);
    attachClearResultsButton(() => undefined);
    clickById("clear-results");
    clickById("clear-results-no");
    await waitForAsyncWork();
    assert.equal(checkIsHidden("clear-results-confirm"), true);
    assert.equal(checkIsHidden("clear-results"), false);
    assert.deepEqual(calls, []);
});

test("test_yes_sends_one_post_resets_the_run_stores_and_reloads", async () => {
    initLayer1Dom();
    const calls: RecordedCall[] = [];
    installRecordingFetch(calls);
    let reloads = 0;
    attachClearResultsButton(() => { reloads += 1; });
    markRunStarted("toolu_clear_me");
    clickById("clear-results");
    clickById("clear-results-yes");
    await waitForAsyncWork();
    assert.deepEqual(calls, [{ url: "/api/layer1-clear-results", method: "POST" }]);
    assert.equal(isRunStarted("toolu_clear_me"), false);
    assert.equal(reloads, 1);
    assert.equal(checkIsHidden("clear-results-confirm"), true);
});

test("test_yes_resets_the_run_queue_before_the_post", async () => {
    initLayer1Dom();
    const queuedRun = { toolUseId: "toolu_queued" } as WireScriptRun;
    runQueueState.queue.push(queuedRun);
    const queueLengthsAtPost: number[] = [];
    const recordQueueLength = async (): Promise<Response> => {
        queueLengthsAtPost.push(runQueueState.queue.length);
        return { ok: true, status: 200 } as Response;
    };
    Object.assign(globalThis, { fetch: recordQueueLength });
    attachClearResultsButton(() => undefined);
    clickById("clear-results");
    clickById("clear-results-yes");
    await waitForAsyncWork();
    assert.deepEqual(queueLengthsAtPost, [0]);
});

test("test_yes_aborts_the_running_script_before_the_post", async () => {
    initPage();
    const log = installServer({ holdRuns: true });
    const probe = installAbortProbe();
    const view = buildView({ "a.ts": [buildRun("slow", 1)] });
    await addRunsToQueue(view, ["slow"]);
    await waitAndAcceptConsent();
    await waitUntil(() => log.runCalls.length === 1);
    attachClearResultsButton(() => undefined);
    clickById("clear-results");
    clickById("clear-results-yes");
    await waitUntil(() => probe.wasAbortedAtPost !== undefined);
    assert.equal(probe.wasAbortedAtPost, true);
    // Drain the late needs request so it cannot hit the next test's stub fetch.
    await waitUntil(() => runQueueState.runningId === undefined);
    await addRunsToQueue(view, []);
});

test("test_a_failed_post_keeps_the_run_stores_skips_the_reload_and_shows_the_error", async () => {
    initLayer1Dom();
    const calls: RecordedCall[] = [];
    installRecordingFetch(calls, false);
    let reloads = 0;
    attachClearResultsButton(() => { reloads += 1; });
    markRunStarted("toolu_keep_me");
    clickById("clear-results");
    clickById("clear-results-yes");
    await waitForAsyncWork();
    assert.equal(isRunStarted("toolu_keep_me"), true);
    assert.equal(reloads, 0);
    assert.match(document.getElementById("busy-error")!.textContent ?? "", /clear results failed: 500/);
});
