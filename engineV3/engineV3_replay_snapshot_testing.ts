// Shared temp-folder helpers for the engineV3_replay_snapshot tests.

import type { TestContext } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";

export function makeTempFolder(t: TestContext, prefix: string): Path {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return new Path(folder);
}

export function writeFileIn(folder: Path, name: string, content: string): string {
  const filePath = join(folder.toString(), name);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}
