// Tests for webapp/app.ts: importing the entry without a browser window must not bootstrap or throw.

import { test } from "node:test";
import assert from "node:assert/strict";

test("test_app_entry_imports_without_a_window", async () => {
  const hadWindow = typeof window !== "undefined";
  assert.equal(hadWindow, false);
  await import("../webapp/app.ts");
});
