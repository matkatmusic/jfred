// Finds what a box run changed: hash the folder after setup, compare after the run, apply the stdout redirect.

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { SandboxBox } from "./reconstruction_script_sandbox_box.ts";
import { isRelativePathOutsideFolder, locateReadOnlyScript } from "./reconstruction_script_sandbox_dir.ts";

const GIT_FOLDER_NAME = ".git";

function hashFilesInto(hashes: Map<string, string>, folder: string, base: string): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const isGitFolder = entry.name === GIT_FOLDER_NAME;
    if (isGitFolder) {
      continue;
    }
    const full = join(folder, entry.name);
    const entryIsDirectory = entry.isDirectory();
    const entryIsFile = entry.isFile();
    if (entryIsDirectory) {
      hashFilesInto(hashes, full, base);
    }
    else if (entryIsFile) {
      hashes.set(relative(base, full), createHash("sha1").update(readFileSync(full)).digest("hex"));
    }
  }
}

// Relative path to sha1 of every regular file; any `.git` entry and non-regular files are skipped.
export function snapshotSandboxFiles(dir: string): Map<string, string> {
  const hashes = new Map<string, string>();
  hashFilesInto(hashes, dir, dir);
  return hashes;
}

// D7: stdout goes to the redirect target inside the temp folder; a target outside the root writes nothing.
export function applyStdoutRedirect(tempDir: string, box: SandboxBox, stdout: string): void {
  const redirect = box.stdoutRedirect;
  if (redirect === undefined) {
    return;
  }
  const absoluteTarget = resolve(box.workdir.toString(), redirect.target.toString());
  const targetRelativePath = relative(box.root.toString(), absoluteTarget);
  if (isRelativePathOutsideFolder(targetRelativePath)) {
    return;
  }
  const targetFile = join(tempDir, targetRelativePath);
  mkdirSync(dirname(targetFile), { recursive: true });
  if (redirect.appends) {
    appendFileSync(targetFile, stdout);
  }
  else {
    writeFileSync(targetFile, stdout);
  }
}

function isValidUtf8(buffer: Buffer): boolean {
  return Buffer.from(buffer.toString("utf8")).equals(buffer);
}

// D2: the script file never counts as changed; post holds its pre value, or nothing when pre has none.
function restoreScriptKey(post: Map<string, string>, preState: Map<string, string>, tempDir: string, box: SandboxBox, workdirFolder: string): void {
  const isScriptOutsideRoot = locateReadOnlyScript(tempDir, box) !== undefined;
  if (isScriptOutsideRoot) {
    return;
  }
  const scriptKey = relative(workdirFolder, join(tempDir, relative(box.root.toString(), box.scriptPath.toString())));
  const preValue = preState.get(scriptKey);
  if (preValue === undefined) {
    post.delete(scriptKey);
  }
  else {
    post.set(scriptKey, preValue);
  }
}

// D2, D6: start files that still exist, plus new or changed UTF-8 files; keys are relative to the workdir.
export function collectBoxPostState(tempDir: string, box: SandboxBox, preState: Map<string, string>, baseline: Map<string, string>): Map<string, string> {
  const workdirFolder = join(tempDir, relative(box.root.toString(), box.workdir.toString()));
  const post = new Map<string, string>();
  for (const [relativePath, hash] of snapshotSandboxFiles(tempDir)) {
    const key = relative(workdirFolder, join(tempDir, relativePath));
    const isChanged = baseline.get(relativePath) !== hash;
    const isStartFile = preState.has(key);
    if (isChanged) {
      const buffer = readFileSync(join(tempDir, relativePath));
      if (isValidUtf8(buffer)) {
        post.set(key, buffer.toString("utf8"));
      }
    }
    else if (isStartFile) {
      post.set(key, readFileSync(join(tempDir, relativePath), "utf8"));
    }
  }
  restoreScriptKey(post, preState, tempDir, box, workdirFolder);
  return post;
}
