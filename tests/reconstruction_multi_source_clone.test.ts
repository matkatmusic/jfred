// Path-remap clone for multi-source joins: rewrites paths in a copy and leaves the input untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { copyRecordReplacingPath } from "../src/reconstruction_multi_source_clone.ts";

test("test_copy_record_replaces_path_in_strings_and_paths_without_mutating_input", () => {
  const original = { cwd: new Path("/alpha/app"), nested: ["/alpha/app/a.py", { file: "/alpha/app/b.py" }] };
  const copy = copyRecordReplacingPath(
    original as unknown as TranscriptRecord, new Path("/alpha/app"), new Path("/beta/app"),
  ) as unknown as typeof original;
  assert.equal(copy.cwd.toString(), "/beta/app");
  assert.deepEqual(copy.nested, ["/beta/app/a.py", { file: "/beta/app/b.py" }]);
  assert.equal(original.cwd.toString(), "/alpha/app");
  assert.equal(original.nested[0], "/alpha/app/a.py");
});
