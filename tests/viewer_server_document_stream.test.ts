// Tests src/viewer_server_document_stream.ts: the console progress sink prints label and counter.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { logBuildProgressToConsole, writeDocumentResponseStream } from "../src/viewer_server_document_stream.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";

test("logBuildProgressToConsole prints the label with its counter", (t) => {
  const log = t.mock.method(console, "log", () => {});
  logBuildProgressToConsole({ kind: DocumentResponseKind.progress, label: "parsing", current: 2, total: 5 });
  assert.equal(log.mock.calls[0]?.arguments[0], "   parsing (2/5)");
});

test("writeDocumentResponseStream ends with an error line when the client socket is gone", () => {
  const ended: string[] = [];
  const response = {
    writeHead: () => {},
    socket: null,
    destroyed: false,
    end: (text: string) => ended.push(text),
  } as unknown as ServerResponse;
  const request = {
    projectName: "p", jsonlName: null, allowScripts: false, declined: false,
    target: undefined, bound: undefined, reconstructPreBaseline: false, baselineQuestion: undefined,
  };
  writeDocumentResponseStream(response, request);
  assert.match(ended[0] ?? "", /client disconnected/);
});
