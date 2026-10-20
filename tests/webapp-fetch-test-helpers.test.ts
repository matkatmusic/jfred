// The fetch stubs answer canned routes, 404 unknown paths, and stream canned NDJSON lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetchRoutes, stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

test("stubFetchRoutes answers a known pathname with its JSON and ignores the query string", async () => {
    stubFetchRoutes({ "/api/known": { value: 7 } });

    const response = await fetch("/api/known?x=1");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { value: 7 });
});

test("stubFetchRoutes answers an unknown pathname with a 404", async () => {
    stubFetchRoutes({});

    const response = await fetch("/api/missing");

    assert.equal(response.status, 404);
});

test("stubStreamRoute streams one NDJSON line per canned entry", async () => {
    stubStreamRoute("/api/stream", [{ step: 1 }, { step: 2 }]);

    const response = await fetch("/api/stream?progress=1");
    const text = await new Response(response.body).text();

    assert.equal(text, '{"step":1}\n{"step":2}\n');
});
