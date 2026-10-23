import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { dispatchLayer1FixtureRoute } from "../src/viewer_api_layer1_fixture.ts";
import { LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS } from "../src/layer1_script_runs_wire.ts";
import { SCRIPT_RUNS } from "../src/viewer_api_layer4_fixture_data.ts";

type WireRunRow = Record<string, unknown>;

function dispatchGet(pathAndQuery: string): { handled: boolean; body: string } {
  let body = "";
  const append = (chunk?: string): void => {
    body += chunk ?? "";
  };
  const response = {
    writeHead: () => response,
    write: append,
    end: append,
    destroyed: false,
    socket: { destroyed: false, writable: true, setNoDelay: () => {}, uncork: () => {} },
  } as unknown as ServerResponse;
  const handled = dispatchLayer1FixtureRoute({ method: "GET" } as IncomingMessage, response, new URL(`http://localhost${pathAndQuery}`));
  return { handled, body };
}

test("the streamed script-runs route sends one progress line per run and ends with the payload", () => {
  const { handled, body } = dispatchGet("/api/layer1-script-runs?progress=1&dir=/ignored");
  assert.equal(handled, true);
  const lines = body.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
  const terminal = lines.at(-1)!;
  const progress = lines.slice(0, -1);
  assert.equal(progress.length, SCRIPT_RUNS.length);
  assert.ok(progress.every((line) => line["kind"] === "progress" && line["label"] === LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS));
  assert.deepEqual(progress.map((line) => line["current"]), [1, 2, 3]);
  assert.ok(Array.isArray(terminal["pairs"]));
  assert.equal(terminal["kind"], undefined);
});

test("the plain script-runs route answers pair paths with ISO instants, joined code and session ids", () => {
  const { body } = dispatchGet("/api/layer1-script-runs");
  const payload = JSON.parse(body) as { pairs: { path: string; scriptRuns: WireRunRow[] }[] };
  assert.deepEqual(payload.pairs.map((pair) => pair.path).sort(), ["src/index.ts", "src/util.ts"]);
  const index = payload.pairs.find((pair) => pair.path === "src/index.ts")!;
  assert.equal(index.scriptRuns.length, 1);
  const python = index.scriptRuns[0]!;
  assert.equal(python["instant"], "2026-06-01T09:03:00.000Z");
  assert.equal(python["toolUseId"], "toolu_fixture_py_rewrite");
  assert.equal(python["executorKind"], "python");
  assert.equal(python["label"], "🐍 rewrite.py");
  assert.equal(python["sessionId"], "fixture-0f3c9a7e");
  assert.equal(python["sessionFile"], "/fixture/demo/projects/0f3c9a7e.jsonl");
  assert.ok((python["code"] as string).startsWith("import pathlib\n\nfor name"));
  assert.equal("axisPx" in python, false);
});

test("a run without a label has no label key and a git-only path draws nowhere", () => {
  const { body } = dispatchGet("/api/layer1-script-runs");
  const payload = JSON.parse(body) as { pairs: { path: string; scriptRuns: WireRunRow[] }[] };
  const util = payload.pairs.find((pair) => pair.path === "src/util.ts")!;
  assert.deepEqual(util.scriptRuns.map((run) => run["toolUseId"]), ["toolu_fixture_py_rewrite", "toolu_fixture_sh_inline"]);
  const inline = util.scriptRuns[1]!;
  assert.equal("label" in inline, false);
  assert.equal(inline["executorKind"], "bash");
  assert.equal(inline["instant"], "2026-06-02T10:00:00.000Z");
  assert.ok(!payload.pairs.some((pair) => pair.path === "scripts/deploy.sh"));
});
