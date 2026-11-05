// Rewrites paths after the Layer 1 component moves. Run: node --import tsx scripts/rewrite_layer1_imports.ts <moves-dir> [--dry-run]

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo-relative posix paths: old webapp/layer1-x.ts -> new webapp/layer1-components/<component>/layer1-x.ts.
export type MoveMap = Map<string, string>;

const JFRED_ROOT = resolve(import.meta.dirname, "..");
const SCANNED_FOLDERS = ["webapp", "tests", "scripts", "src"];
const SKIPPED_PATH_PARTS = ["/dist/", "/vendor/", "/archive/", "node_modules", "computed-style-"];
const QUOTED_TOKEN = /(["'`])([^"'`\s]+)\1/g;
const NAMED_LAYER1_FILE = /^(.*?)(layer1-[a-z0-9-]+)\.(ts|js)$/;

function normalizeRepoPath(path: string): string {
  const relativePath = relative(JFRED_ROOT, resolve(JFRED_ROOT, path));
  return relativePath.replaceAll("\\", "/");
}

// Reads every <component>.json written by the move helpers.
export function readMoveMap(movesDir: string): MoveMap {
  const moves: MoveMap = new Map();
  for (const name of readdirSync(movesDir)) {
    const isJson = name.endsWith(".json");
    if (isJson) {
      const record = JSON.parse(readFileSync(resolve(movesDir, name), "utf8")) as { movedFiles: { from: string; to: string }[] };
      for (const movedFile of record.movedFiles) {
        moves.set(normalizeRepoPath(movedFile.from), normalizeRepoPath(movedFile.to));
      }
    }
  }
  return moves;
}

// The new location of a moved target, keeping the specifier's .ts or .js extension.
function findMovedTarget(oldTarget: string, moves: MoveMap): string | undefined {
  const extension = posix.extname(oldTarget);
  const movedTarget = moves.get(oldTarget.replace(/\.js$/, ".ts"));
  if (movedTarget === undefined) {
    return undefined;
  }
  return movedTarget.replace(/\.ts$/, extension);
}

function formatRelativeSpecifier(fromFilePath: string, target: string, oldSpecifier: string): string {
  let newSpecifier = posix.relative(posix.dirname(fromFilePath), target) || ".";
  const startsWithDot = newSpecifier.startsWith(".");
  if (startsWithDot === false) {
    newSpecifier = `./${newSpecifier}`;
  }
  const hasTrailingSlash = oldSpecifier.endsWith("/");
  if (hasTrailingSlash) {
    newSpecifier = `${newSpecifier}/`;
  }
  return newSpecifier;
}

function convertRelativeSpecifier(specifier: string, oldFilePath: string, newFilePath: string, moves: MoveMap, isPresent: (path: string) => boolean): string {
  const oldTarget = posix.join(posix.dirname(oldFilePath), specifier);
  const movedTarget = findMovedTarget(oldTarget, moves);
  if (movedTarget !== undefined) {
    return formatRelativeSpecifier(newFilePath, movedTarget, specifier);
  }
  const isFileMoved = newFilePath !== oldFilePath;
  const isTargetPresent = isPresent(oldTarget);
  const isRecomputed = isFileMoved && isTargetPresent;
  if (isRecomputed) {
    return formatRelativeSpecifier(newFilePath, oldTarget, specifier);
  }
  return specifier;
}

// Root-relative "webapp/layer1-x.ts", dist URL "/app/layer1-x.js", and a bare "layer1-x.ts" path segment.
function convertNamedSpecifier(specifier: string, moves: MoveMap): string {
  const match = NAMED_LAYER1_FILE.exec(specifier);
  if (match === null) {
    return specifier;
  }
  const [, prefix, stem, extension] = match as unknown as [string, string, string, string];
  return convertMatchedNamedSpecifier(specifier, prefix, stem, extension, moves);
}

function convertMatchedNamedSpecifier(specifier: string, prefix: string, stem: string, extension: string, moves: MoveMap): string {
  const movedTarget = moves.get(`webapp/${stem}.ts`);
  if (movedTarget === undefined) {
    return specifier;
  }
  const isBare = prefix === "";
  const isDistUrl = prefix === "/app/";
  const isWebappPath = prefix.endsWith("webapp/");
  const isKnownPrefix = isBare || isDistUrl || isWebappPath;
  if (isKnownPrefix === false) {
    return specifier;
  }
  const webappRelativeTarget = movedTarget.replace(/^webapp\//, "");
  return prefix + webappRelativeTarget.replace(/\.ts$/, `.${extension}`);
}

export function convertSpecifier(specifier: string, oldFilePath: string, newFilePath: string, moves: MoveMap, isPresent: (path: string) => boolean): string {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (isRelative) {
    return convertRelativeSpecifier(specifier, oldFilePath, newFilePath, moves, isPresent);
  }
  return convertNamedSpecifier(specifier, moves);
}

// Every quoted token is a candidate; tokens that name no file stay as they are.
export function replaceFileSpecifiers(text: string, oldFilePath: string, newFilePath: string, moves: MoveMap, isPresent: (path: string) => boolean): string {
  let rewrittenText = "";
  let copiedUpTo = 0;
  for (const token of text.matchAll(QUOTED_TOKEN)) {
    const [wholeToken, quote, specifier] = token as unknown as [string, string, string];
    const newSpecifier = convertSpecifier(specifier, oldFilePath, newFilePath, moves, isPresent);
    rewrittenText += text.slice(copiedUpTo, token.index) + quote + newSpecifier + quote;
    copiedUpTo = token.index + wholeToken.length;
  }
  return rewrittenText + text.slice(copiedUpTo);
}

function isSkippedPath(path: string): boolean {
  for (const part of SKIPPED_PATH_PARTS) {
    const hasPart = path.includes(part);
    if (hasPart) {
      return true;
    }
  }
  return false;
}

function listFolderSourceFiles(folder: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(resolve(JFRED_ROOT, folder), { recursive: true }) as string[]) {
    const path = `${folder}/${entry.replaceAll("\\", "/")}`;
    const isSource = path.endsWith(".ts") || path.endsWith(".mts");
    const isKept = isSkippedPath(path) === false;
    const isScanned = isSource && isKept;
    if (isScanned) {
      files.push(path);
    }
  }
  return files;
}

function isPresentInRepo(path: string): boolean {
  return existsSync(resolve(JFRED_ROOT, path)) || existsSync(resolve(JFRED_ROOT, path.replace(/\.js$/, ".ts")));
}

function updateFileSpecifiers(newFilePath: string, oldFilePath: string, moves: MoveMap, isDryRun: boolean): void {
  const text = readFileSync(resolve(JFRED_ROOT, newFilePath), "utf8");
  const rewrittenText = replaceFileSpecifiers(text, oldFilePath, newFilePath, moves, isPresentInRepo);
  const isChanged = rewrittenText !== text;
  if (isChanged) {
    console.log(`rewrote ${newFilePath}`);
  }
  const isWritten = isChanged && isDryRun === false;
  if (isWritten) {
    writeFileSync(resolve(JFRED_ROOT, newFilePath), rewrittenText);
  }
}

// Runs after the moves: a moved file's old location comes from the reverse map.
function executeCodemod(movesDir: string, isDryRun: boolean): void {
  const moves = readMoveMap(movesDir);
  const oldPathOfNewPath = new Map<string, string>();
  for (const [from, to] of moves) {
    oldPathOfNewPath.set(to, from);
  }
  for (const folder of SCANNED_FOLDERS) {
    for (const newFilePath of listFolderSourceFiles(folder)) {
      updateFileSpecifiers(newFilePath, oldPathOfNewPath.get(newFilePath) ?? newFilePath, moves, isDryRun);
    }
  }
}

const isEntryScript = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryScript) {
  executeCodemod(process.argv[2]!, process.argv.includes("--dry-run"));
}
