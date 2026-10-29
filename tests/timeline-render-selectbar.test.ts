// Consent query params and the cached range-patch fetch, driven through a fresh happy-dom.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import type { TimelineRenderContext } from "../webapp/views/timeline-render-context.ts";

async function loadSelectbarModules() {
  initWebappDom();
  const choices = await import("../webapp/app-choices.ts");
  const selectbar = await import("../webapp/views/timeline-render-selectbar.ts");
  return { ...choices, ...selectbar };
}

test("test_buildConsentParams_sends_project_only_when_nothing_is_stored", async () => {
  const { buildConsentParams } = await loadSelectbarModules();
  const context = { project: "demo" } as unknown as TimelineRenderContext;
  assert.equal(buildConsentParams(context).toString(), "project=demo");
});

test("test_buildConsentParams_adds_allowScripts_for_consent_and_preBaseline_for_stored_answer", async () => {
  const { buildConsentParams, storeConsentChoice, storeBaselineChoice } = await loadSelectbarModules();
  storeConsentChoice("demo", "1");
  storeBaselineChoice("demo", "0");
  const context = { project: "demo" } as unknown as TimelineRenderContext;
  const params = buildConsentParams(context);
  assert.equal(params.get("allowScripts"), "1");
  assert.equal(params.get("preBaseline"), "0");
  assert.equal(params.has("declined"), false);
});

test("test_buildConsentParams_adds_declined_when_consent_was_refused", async () => {
  const { buildConsentParams, storeConsentChoice } = await loadSelectbarModules();
  storeConsentChoice("demo", "0");
  const context = { project: "demo" } as unknown as TimelineRenderContext;
  const params = buildConsentParams(context);
  assert.equal(params.get("declined"), "1");
  assert.equal(params.has("allowScripts"), false);
});

test("test_fetchRangePatch_returns_the_cached_text_for_the_same_step_range", async () => {
  const { fetchRangePatch } = await loadSelectbarModules();
  const context = { project: "demo", cachedPatch: { key: "2-5", text: "cached patch" } } as unknown as TimelineRenderContext;
  assert.equal(await fetchRangePatch(context, 2, 5), "cached patch");
});
