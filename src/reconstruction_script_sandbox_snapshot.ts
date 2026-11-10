// Finds what a box run changed: hash the folder after setup, compare after the run, apply the stdout redirect.

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { SandboxBox } from "./reconstruction_script_sandbox_box.ts";
import { isRelativePathOutsideFolder, locateReadOnlyScript } from "./reconstruction_script_sandbox_dir.ts";

const GIT_FOLDER_NAME = ".git";

function computeFileHash(filePath: string): string {
  const hash = createHash("sha1");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function collectEntryHashInto(hashes: Map<string, string>, entry: Dirent, folder: string, base: string): void {
  const full = join(folder, entry.name);
  const isGitFolder = entry.name === GIT_FOLDER_NAME;
  const isDirectory = entry.isDirectory();
  const isFile = entry.isFile();
  if (isGitFolder) {
    return;
  }
  if (isDirectory) {
    collectHashesInto(hashes, full, base);
  }
  else if (isFile) {
    hashes.set(relative(base, full), computeFileHash(full));
  }
}

function collectHashesInto(hashes: Map<string, string>, folder: string, base: string): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    collectEntryHashInto(hashes, entry, folder, base);
  }
}

// Relative path to sha1 of every regular file; any `.git` entry and non-regular files are skipped.
export function collectSandboxFileHashes(dir: string): Map<string, string> {
  const hashes = new Map<string, string>();
  collectHashesInto(hashes, dir, dir);
  return hashes;
}

function writeRedirectTarget(targetFile: string, appends: boolean, stdout: string): void {
  mkdirSync(dirname(targetFile), { recursive: true });
  if (appends) {
    appendFileSync(targetFile, stdout);
  }
  else {
    writeFileSync(targetFile, stdout);
  }
}

// D7: stdout goes to the redirect target inside the temp folder; a target outside the root writes nothing.
export function applyStdoutRedirect(tempDir: string, box: SandboxBox, stdout: string): void {
  const redirect = box.stdoutRedirect;
  if (redirect === undefined) {
    return;
  }
  const absoluteTarget = resolve(box.workdir.toString(), redirect.target.toString());
  const targetRelativePath = relative(box.root.toString(), absoluteTarget);
  const isOutsideRoot = isRelativePathOutsideFolder(targetRelativePath);
  if (isOutsideRoot) {
    return;
  }
  writeRedirectTarget(join(tempDir, targetRelativePath), redirect.appends, stdout);
}

function isValidUtf8(buffer: Buffer): boolean {
  return Buffer.from(buffer.toString("utf8")).equals(buffer);
}

// The workdir key of the script file, or undefined when the script lives outside the root.
function findScriptKey(tempDir: string, box: SandboxBox, workdirFolder: string): string | undefined {
  const isScriptOutsideRoot = locateReadOnlyScript(tempDir, box) !== undefined;
  if (isScriptOutsideRoot) {
    return undefined;
  }
  return relative(workdirFolder, join(tempDir, relative(box.root.toString(), box.scriptPath.toString())));
}

// D2: the script file never counts as changed; post holds its pre value, or nothing when pre has none.
function setScriptKeyToPreValue(post: Map<string, string>, preState: Map<string, string>, scriptKey: string | undefined): void {
  if (scriptKey === undefined) {
    return;
  }
  const preValue = preState.get(scriptKey);
  if (preValue === undefined) {
    post.delete(scriptKey);
  }
  else {
    post.set(scriptKey, preValue);
  }
}

// Start files that still exist, changed UTF-8 files, and two key lists.
export type BoxPostState = { post: Map<string, string>; deletedKeys: string[]; notTextKeys: string[] };

function sortChangedFile(state: BoxPostState, key: string, buffer: Buffer): void {
  const isText = isValidUtf8(buffer);
  if (isText) {
    state.post.set(key, buffer.toString("utf8"));
  }
  else {
    state.notTextKeys.push(key);
  }
}

function collectAfterRunFiles(state: BoxPostState, tempDir: string, workdirFolder: string, afterRun: Map<string, string>, preState: Map<string, string>, baseline: Map<string, string>): void {
  for (const [relativePath, hash] of afterRun) {
    const key = relative(workdirFolder, join(tempDir, relativePath));
    const filePath = join(tempDir, relativePath);
    const isChanged = baseline.get(relativePath) !== hash;
    const isStartFile = preState.has(key);
    if (isChanged) {
      sortChangedFile(state, key, readFileSync(filePath));
    }
    else if (isStartFile) {
      state.post.set(key, readFileSync(filePath, "utf8"));
    }
  }
}

function collectDeletedKeys(baseline: Map<string, string>, afterRun: Map<string, string>, tempDir: string, workdirFolder: string, scriptKey: string | undefined): string[] {
  const deletedKeys: string[] = [];
  for (const relativePath of baseline.keys()) {
    const key = relative(workdirFolder, join(tempDir, relativePath));
    const isDeleted = !afterRun.has(relativePath) && key !== scriptKey;
    if (isDeleted) {
      deletedKeys.push(key);
    }
  }
  return deletedKeys;
}

// D2, D6: keys are relative to the workdir.
export function collectBoxPostState(tempDir: string, box: SandboxBox, preState: Map<string, string>, baseline: Map<string, string>): BoxPostState {
  const workdirFolder = join(tempDir, relative(box.root.toString(), box.workdir.toString()));
  const state: BoxPostState = { post: new Map<string, string>(), deletedKeys: [], notTextKeys: [] };
  const afterRun = collectSandboxFileHashes(tempDir);
  collectAfterRunFiles(state, tempDir, workdirFolder, afterRun, preState, baseline);
  const scriptKey = findScriptKey(tempDir, box, workdirFolder);
  state.deletedKeys = collectDeletedKeys(baseline, afterRun, tempDir, workdirFolder, scriptKey);
  setScriptKeyToPreValue(state.post, preState, scriptKey);
  return state;
}
