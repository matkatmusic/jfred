// The temp folder a replayed script runs in: seeded files plus the script text.

import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative, basename, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { Path } from "./structures/domain.ts";
import type { SandboxBox } from "./reconstruction_script_sandbox_box.ts";
import { cloneProjectAtCommit } from "./reconstruction_script_sandbox_project.ts";

export const SANDBOX_TIMEOUT_MS = 5000;

export function isRelativePathOutsideFolder(relativePath: string): boolean {
  if (relativePath === "..") {
    return true;
  }
  if (relativePath.startsWith("../")) {
    return true;
  }
  return isAbsolute(relativePath);
}

function getScriptFolderPath(tempDir: string): string {
  return `${tempDir}-script`;
}

function writeSandboxFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

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

// A script outside the box root is mounted read-only from a second folder; undefined when inside.
export function locateReadOnlyScript(tempDir: string, box: SandboxBox): { hostFile: Path; boxFile: Path } | undefined {
  const scriptRelativePath = relative(box.root.toString(), box.scriptPath.toString());
  if (!isRelativePathOutsideFolder(scriptRelativePath)) {
    return undefined;
  }
  const hostFile = new Path(join(getScriptFolderPath(tempDir), basename(box.scriptPath.toString())));
  return { hostFile, boxFile: box.scriptPath };
}

export function removeSandboxDirectory(tempDir: string): void {
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(getScriptFolderPath(tempDir), { recursive: true, force: true });
}

// The temp folder is empty when the clone starts; start files and the script go on top.
function fillBoxDirectory(tempDir: string, script: string, preState: Map<string, string>, box: SandboxBox): void {
  if (box.project !== undefined) {
    cloneProjectAtCommit(box.project.repo, box.project.commit, new Path(tempDir));
  }
  const workdirRelativePath = relative(box.root.toString(), box.workdir.toString());
  for (const [relativePath, content] of preState) {
    writeSandboxFile(join(tempDir, workdirRelativePath, relativePath), content);
  }
  const readOnlyScript = locateReadOnlyScript(tempDir, box);
  if (readOnlyScript === undefined) {
    writeSandboxFile(join(tempDir, relative(box.root.toString(), box.scriptPath.toString())), script);
  }
  else {
    writeSandboxFile(readOnlyScript.hostFile.toString(), script);
  }
}

// Returns the new temp dir; the caller removes it with removeSandboxDirectory.
export function prepareSandboxDirectory(script: string, preState: Map<string, string>, box?: SandboxBox): string {
  const tempDir = mkdtempSync(join(tmpdir(), "reveng-"));
  if (box !== undefined) {
    fillBoxDirectory(tempDir, script, preState, box);
    return tempDir;
  }
  for (const [relativePath, content] of preState) {
    const dest = join(tempDir, relativePath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  writeFileSync(join(tempDir, "__script__.py"), script);
  return tempDir;
}
