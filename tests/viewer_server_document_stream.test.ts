// Tests src/viewer_server_document_stream.ts: the console progress sink prints label and counter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { logBuildProgressToConsole } from "../src/viewer_server_document_stream.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";

test("logBuildProgressToConsole prints the label with its counter", (t) => {
  const log = t.mock.method(console, "log", () => {});
  logBuildProgressToConsole({ kind: DocumentResponseKind.progress, label: "parsing", current: 2, total: 5 });
  assert.equal(log.mock.calls[0]?.arguments[0], "   parsing (2/5)");
});
