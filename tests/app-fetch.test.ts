// DOM tests for webapp/app-fetch.ts: JSON/text fetches, the raw-line cache, and the document cache helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import { stubFetchRoutes, stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

test("test_fetchJson_returns_the_stubbed_payload", async () => {
  initWebappDom();
  stubFetchRoutes({ "/api/projects": [{ name: "proj-a" }] });
  const { fetchJson } = await import("../webapp/app-fetch.ts");
  assert.deepEqual(await fetchJson("/api/projects"), [{ name: "proj-a" }]);
});

test("test_fetchJson_throws_on_an_unstubbed_route", async () => {
  initWebappDom();
  stubFetchRoutes({});
  const { fetchJson } = await import("../webapp/app-fetch.ts");
  await assert.rejects(fetchJson("/api/missing"), /404/);
});

test("test_clearProjectDocuments_drops_only_that_projects_keys", async () => {
  initWebappDom();
  const { documentCache, clearProjectDocuments, getCachedDocument } = await import("../webapp/app-fetch.ts");
  documentCache.set("proj-a|*", { id: "a" });
  documentCache.set("proj-b|*", { id: "b" });
  assert.deepEqual(getCachedDocument("proj-a"), { id: "a" });
  clearProjectDocuments("proj-a");
  assert.equal(getCachedDocument("proj-a"), undefined);
  assert.deepEqual(getCachedDocument("proj-b"), { id: "b" });
});

test("test_fetchDocument_streams_then_serves_the_second_call_from_cache", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  initWebappDom();
  stubStreamRoute("/api/document", [{ kind: "progress", label: "loading" }, { messages: [] }]);
  const { fetchDocument } = await import("../webapp/app-fetch.ts");
  const first = await fetchDocument("proj-doc");
  assert.deepEqual(first.document, { messages: [] });
  stubFetchRoutes({});
  const second = await fetchDocument("proj-doc");
  assert.deepEqual(second.document, { messages: [] });
});
