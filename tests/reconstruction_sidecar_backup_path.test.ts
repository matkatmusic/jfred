import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSidecarBackupPath, createSidecarReader } from "../src/reconstruction_sidecar_backup_path.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

test("buildSidecarBackupPath joins root, session id and backup file name", () => {
  const backupPath = buildSidecarBackupPath(new Uuid("sess-1"), new Path("/root"), new Path("abc@v1"));
  assert.equal(backupPath, join("/root", "sess-1", "abc@v1"));
});

test("createSidecarReader reads the backup file text from disk", () => {
  const root = mkdtempSync(join(tmpdir(), "sidecar-backup-path-"));
  mkdirSync(join(root, "sess-1"));
  writeFileSync(join(root, "sess-1", "abc@v1"), "backup text");
  const readBackup = createSidecarReader(new Uuid("sess-1"), new Path(root));
  assert.equal(readBackup(new Path("abc@v1")), "backup text");
});
