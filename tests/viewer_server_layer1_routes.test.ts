// Task 355 step 6: dispatchLayer1Route owns /api/layer1-edits in real (non-fixture) mode and ignores unknown paths.

import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { enableFixtureMode } from "../src/viewer_api_layer1_fixture.ts";
import { dispatchLayer1Route } from "../src/viewer_server_layer1_routes.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

function dispatchGet(pathAndQuery: string): { handled: boolean; body: string } {
    let body = "";
    const append = (chunk?: string): void => {
        body += chunk ?? "";
    };
    const response = { writeHead: () => response, write: append, end: append } as unknown as ServerResponse;
    const handled = dispatchLayer1Route({ method: "GET" } as IncomingMessage, response, new URL(`http://localhost${pathAndQuery}`));
    return { handled, body };
}

test("test_dispatch_routes_layer1_edits_to_the_real_handler", () => {
    const { handled, body } = dispatchGet(`/api/layer1-edits?dir=${encodeURIComponent(createTempDir())}`);
    assert.equal(handled, true);
    assert.deepEqual(JSON.parse(body), { pairs: [] });
});

test("test_dispatch_routes_layer1_branches_to_the_real_handler", () => {
    const { handled, body } = dispatchGet(`/api/layer1-branches?dir=${encodeURIComponent(createTempDir())}`);
    assert.equal(handled, true);
    assert.deepEqual(JSON.parse(body), { pairs: [] });
});

test("test_dispatch_leaves_unknown_paths_unowned", () => {
    assert.equal(dispatchGet("/api/not-a-layer1-route").handled, false);
});

const ROUTE_PATHS = [
    "/api/layer1-script-run",
    "/api/layer1-script-needs",
    "/api/layer1-clear-results",
    "/api/layer1-jfred-commit",
    "/api/layer1-jfred-delete",
];

function dispatchPost(pathname: string): boolean {
    const request = { method: "POST", headers: {} } as unknown as IncomingMessage;
    return dispatchLayer1Route(request, {} as ServerResponse, new URL(`http://localhost${pathname}`));
}

test("test_dispatch_reaches_the_real_post_handlers_in_the_non_fixture_chain", () => {
    for (const pathname of ROUTE_PATHS) {
        assert.throws(() => dispatchPost(pathname), /content type must be/);
    }
});

// Last tests: fixture mode cannot be switched off again in this process.
test("test_dispatch_does_not_reach_the_real_post_handlers_in_fixture_mode", async () => {
    enableFixtureMode();
    for (const pathname of ROUTE_PATHS) {
        let failure = "";
        try {
            dispatchPost(pathname);
        }
        catch (error) {
            failure = String(error);
        }
        assert.doesNotMatch(failure, /content type must be/);
    }
    // the commit route is answered by the canned handler: the last body line is a committed reply.
    const commitLines = await dispatchFixtureCommit({ baseShortHash: "a1b2c3d4", markInstant: "2026-06-03T14:00:00Z", message: "m" });
    assert.equal(JSON.parse(commitLines.at(-1)!).outcome, "committed");
    // the delete route has no canned handler, so the dispatch does not own it.
    assert.equal(dispatchPost("/api/layer1-jfred-delete"), false);
});

// Streams the canned commit reply as NDJSON lines; the stand-in socket lets the progress writes through.
function dispatchFixtureCommit(commitRequest: Record<string, string>): Promise<string[]> {
    return new Promise((resolve) => {
        let body = "";
        const socket = { setNoDelay() {}, uncork() {}, destroyed: false, writable: true };
        const response = {
            socket,
            destroyed: false,
            writableCorked: 0,
            writeHead() { return response; },
            write(chunk: string) { body += chunk; return true; },
            end(chunk: string) { body += chunk; resolve(body.trim().split("\n")); },
        } as unknown as ServerResponse;
        const request = Object.assign(Readable.from([JSON.stringify(commitRequest)]), { method: "POST", headers: {} }) as unknown as IncomingMessage;
        dispatchLayer1Route(request, response, new URL("http://localhost/api/layer1-jfred-commit"));
    });
}

test("test_fixture_commit_route_replies_unchanged_with_the_next_instant_for_the_chosen_mark", async () => {
    enableFixtureMode();
    // The chosen canned mark is the early tick; its instant is stated here, not read from the source.
    const lines = await dispatchFixtureCommit({ baseShortHash: "a1b2c3d4", markInstant: "2026-06-03T11:00:00Z", message: "m" });
    // the first line is progress, and the last line is the unchanged reply.
    assert.equal(JSON.parse(lines[0]!).kind, "progress");
    // the next instant is the late tick.
    assert.deepEqual(JSON.parse(lines.at(-1)!), { outcome: "unchanged", nextInstant: "2026-06-03T18:20:00.000Z" });
});

test("test_fixture_commit_route_replies_committed_with_the_next_canned_hash_for_any_other_mark", async () => {
    enableFixtureMode();
    // A mark other than the chosen one, whose parent is the second canned commit.
    const lines = await dispatchFixtureCommit({ baseShortHash: "a1b2c3d4", parentShortHash: "c0ffee02", markInstant: "2026-06-03T14:00:00Z", message: "third" });
    // the new commit takes the next canned hash and chains to its parent.
    assert.deepEqual(JSON.parse(lines.at(-1)!), {
        outcome: "committed",
        commit: { instant: "2026-06-03T14:00:00Z", shortHash: "c0ffee03", parentShortHash: "c0ffee02", message: "third" },
    });
});
