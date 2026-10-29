import { test } from "node:test";
import assert from "node:assert/strict";
import { SAVED_PROJECT, createSettingsRouteStub, waitForSettle } from "./layer1-settings-test-helpers.ts";

test("SAVED_PROJECT uses one directory for dir and repo", () => {
  assert.equal(SAVED_PROJECT.dir, SAVED_PROJECT.repo);
});

test("the stub answers GET with the saved file and records no post", async () => {
  const route = createSettingsRouteStub({ lastDir: null }, true);
  const response = await fetch("/api/settings");
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { lastDir: null });
  assert.deepEqual(route.posted(), []);
});

test("the stub records each POST body and reports success", async () => {
  const route = createSettingsRouteStub(null, true);
  const response = await fetch("/api/settings", { method: "POST", body: JSON.stringify({ a: 1 }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { saved: true });
  assert.deepEqual(route.posted(), [{ a: 1 }]);
});

test("the stub reports a failed save with status 500 and the disk-full text", async () => {
  createSettingsRouteStub(null, false);
  const response = await fetch("/api/settings", { method: "POST", body: "{}" });
  assert.equal(response.ok, false);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "disk full");
});

test("waitForSettle resolves after a macrotask turn", async () => {
  let ran = false;
  setTimeout(() => {
    ran = true;
  }, 0);
  await waitForSettle();
  assert.equal(ran, true);
});
