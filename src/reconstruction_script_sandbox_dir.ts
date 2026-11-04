// The temp folder a replayed script runs in: seeded files plus the script text.

import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";

export const SANDBOX_TIMEOUT_MS = 5000;

export function readAllFiles(dir: string, base: string = dir): [string, string][] {
  const files: [string, string][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const entryIsDirectory = entry.isDirectory();
    const entryIsFile = entry.isFile();
    if (entryIsDirectory) {
      files.push(...readAllFiles(full, base));
    }
    else if (entryIsFile) {
      files.push([relative(base, full), readFileSync(full, "utf8")]);
    }
  }
  return files;
}

// Returns the new temp dir; the caller removes it.
export function prepareSandboxDirectory(script: string, preState: Map<string, string>): string {
  const tempDir = mkdtempSync(join(tmpdir(), "reveng-"));
  for (const [relativePath, content] of preState) {
    const dest = join(tempDir, relativePath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  writeFileSync(join(tempDir, "__script__.py"), script);
  return tempDir;
}
