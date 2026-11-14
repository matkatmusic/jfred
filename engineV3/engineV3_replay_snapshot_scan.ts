// Walks the watched folders and stamps every file, folder and symlink with its lstat data and content hash.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, type BigIntStats } from "node:fs";
import { join } from "node:path";
import type { Path } from "../src/structures/domain.ts";

export enum FileKind {
  File = "file",
  Directory = "directory",
  Symlink = "symlink",
}

export type FileStamp = {
  kind: FileKind;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  ino: bigint;
  mode: string;
  symlinkTarget?: string;
  contentHash?: string;
};

const LSTAT_STAMP_KEYS = ["kind", "size", "mtimeNs", "ctimeNs", "ino", "mode"] as const;
const PERMISSION_BITS_MASK = 0o777n;
const HASH_PREFIX = "sha256:";

function getFileKind(stats: BigIntStats): FileKind | undefined {
  const isFile = stats.isFile();
  if (isFile) {
    return FileKind.File;
  }
  const isDirectory = stats.isDirectory();
  if (isDirectory) {
    return FileKind.Directory;
  }
  const isSymlink = stats.isSymbolicLink();
  if (isSymlink) {
    return FileKind.Symlink;
  }
  return undefined;
}

function isSameLstatData(first: FileStamp, second: FileStamp): boolean {
  for (const key of LSTAT_STAMP_KEYS) {
    if (first[key] !== second[key]) {
      return false;
    }
  }
  return true;
}

function computeFileContentHash(path: string, stamp: FileStamp, previous: FileStamp | undefined): string {
  if (previous !== undefined) {
    const isUnchanged = isSameLstatData(previous, stamp);
    if (isUnchanged) {
      return previous.contentHash!;
    }
  }
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return HASH_PREFIX + hash.digest("hex");
}

function createLstatStamp(stats: BigIntStats, kind: FileKind): FileStamp {
  const permissionBits = stats.mode & PERMISSION_BITS_MASK;
  const mode = permissionBits.toString(8).padStart(3, "0");
  return { kind, size: stats.size, mtimeNs: stats.mtimeNs, ctimeNs: stats.ctimeNs, ino: stats.ino, mode };
}

function createPathStamp(path: string, previous: FileStamp | undefined): FileStamp | undefined {
  const stats = lstatSync(path, { bigint: true });
  const kind = getFileKind(stats);
  if (kind === undefined) {
    return undefined;
  }
  const stamp = createLstatStamp(stats, kind);
  if (kind === FileKind.Symlink) {
    stamp.symlinkTarget = readlinkSync(path);
  }
  if (kind === FileKind.File) {
    stamp.contentHash = computeFileContentHash(path, stamp, previous);
  }
  return stamp;
}

function scanEntry(path: string, skipFolders: string[], previous: Map<string, FileStamp>, stamps: Map<string, FileStamp>): void {
  const isSkipped = skipFolders.includes(path);
  if (isSkipped) {
    return;
  }
  const stamp = createPathStamp(path, previous.get(path));
  if (stamp === undefined) {
    return;
  }
  stamps.set(path, stamp);
  if (stamp.kind === FileKind.Directory) {
    scanFolder(path, skipFolders, previous, stamps);
  }
}

function scanFolder(folder: string, skipFolders: string[], previous: Map<string, FileStamp>, stamps: Map<string, FileStamp>): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    scanEntry(join(folder, entry.name), skipFolders, previous, stamps);
  }
}

export function scanWatchedFolders(folders: Path[], skipFolders: Path[], previous: Map<string, FileStamp>): Map<string, FileStamp> {
  const skipFolderTexts: string[] = [];
  for (const skipFolder of skipFolders) {
    skipFolderTexts.push(skipFolder.toString());
  }
  const stamps = new Map<string, FileStamp>();
  for (const folder of folders) {
    // A watched folder that a recorded command makes later has no files yet.
    const folderExists = existsSync(folder.toString());
    if (folderExists) {
      scanFolder(folder.toString(), skipFolderTexts, previous, stamps);
    }
  }
  return stamps;
}
