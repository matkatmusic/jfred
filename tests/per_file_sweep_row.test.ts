import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSweepRow } from "../scripts/per_file_sweep_row.ts";
import { readSweepSettings } from "../scripts/per_file_sweep_settings.ts";
import { Path } from "../src/structures/domain.ts";

test("test_buildSweepRow_reports_no_revisions_for_an_unknown_file", () => {
  const repo = mkdtempSync(join(tmpdir(), "sweep-row-"));
  writeFileSync(join(repo, "here.txt"), "x\n");
  const settings = readSweepSettings(["--repo", repo]);

  const present = buildSweepRow(settings, [], undefined, new Path(repo), new Path("here.txt"));
  const absent = buildSweepRow(settings, [], undefined, new Path(repo), new Path("gone.txt"));

  assert.equal(present.file.toString(), "here.txt");
  assert.equal(present.revisions, 0);
  assert.equal(present.diskMatched, false);
  assert.equal(present.baselineBlobMatched, false);
  assert.equal(absent.note, "absent from the working tree");
});
