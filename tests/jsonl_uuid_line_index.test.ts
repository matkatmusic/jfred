import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { buildUuidLineIndex } from "../scripts/jsonl_uuid_line_index.ts";

const root = mkdtempSync(join(tmpdir(), "jsonl-uuid-line-index-test-"));

after(() => rmSync(root, { recursive: true, force: true }));

test("buildUuidLineIndex maps uuids to 1-based lines, skipping blank and uuid-less lines", () => {
  const first = join(root, "a.jsonl");
  const second = join(root, "b.jsonl");
  writeFileSync(first, `${JSON.stringify({ uuid: "u1" })}\n\n${JSON.stringify({ type: "x" })}\n${JSON.stringify({ uuid: "u2" })}\n`);
  writeFileSync(second, `${JSON.stringify({ uuid: "u3" })}\n`);
  const index = buildUuidLineIndex([new Path(first), new Path(second)]);
  assert.deepEqual([...index.entries()], [["u1", 1], ["u2", 4], ["u3", 1]]);
});
