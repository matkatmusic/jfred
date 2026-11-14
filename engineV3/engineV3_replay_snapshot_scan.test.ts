import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { chmodSync, mkdirSync, symlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { FileKind, scanWatchedFolders } from "./engineV3_replay_snapshot_scan.ts";
import { makeTempFolder, writeFileIn } from "./engineV3_replay_snapshot_testing.ts";

function hashOf(content: string): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

test("test_scanWatchedFolders_stamps_a_file_with_kind_mode_and_content_hash", (t) => {
  // Scenario: one file with known content appears in the scan with its kind, mode and sha256 hash.
  const folder = makeTempFolder(t, "snap-scan-");
  // write a.txt, then scan the folder
  const filePath = writeFileIn(folder, "a.txt", "hello");
  const stamps = scanWatchedFolders([folder], [makeTempFolder(t, "snap-skip-")], new Map());
  // the stamp holds kind file, an octal mode string, and the hash of "hello"
  const stamp = stamps.get(filePath)!;
  assert.equal(stamp.kind, FileKind.File);
  assert.match(stamp.mode, /^[0-7]{3}$/);
  assert.equal(stamp.contentHash, hashOf("hello"));
});

test("test_scanWatchedFolders_lists_nothing_for_a_watched_folder_that_does_not_exist_yet", (t) => {
  // Scenario: the check folder is made by a recorded command later in the replay, so at the start it is not there.
  const folder = makeTempFolder(t, "snap-scan-");
  // scan a folder path that was never made
  const stamps = scanWatchedFolders([new Path(join(folder.toString(), "not-made-yet"))], [makeTempFolder(t, "snap-skip-")], new Map());
  // nothing is listed
  assert.equal(stamps.size, 0);
});
test("test_scanWatchedFolders_records_a_symlink_target_without_following_it", (t) => {
  // Scenario: a link to a folder is one symlink entry; the files behind the link are not listed.
  const folder = makeTempFolder(t, "snap-scan-");
  // make real/inner.txt and a link to the real folder
  writeFileIn(folder, "real/inner.txt", "x");
  const linkPath = join(folder.toString(), "link");
  symlinkSync("real", linkPath);
  const stamps = scanWatchedFolders([folder], [makeTempFolder(t, "snap-skip-")], new Map());
  // the link has kind symlink, the target text, no hash, and nothing is listed under it
  const stamp = stamps.get(linkPath)!;
  assert.equal(stamp.kind, FileKind.Symlink);
  assert.equal(stamp.symlinkTarget, "real");
  assert.equal(stamp.contentHash, undefined);
  assert.equal(stamps.has(join(linkPath, "inner.txt")), false);
});

test("test_scanWatchedFolders_skips_the_skip_folder", (t) => {
  // Scenario: files under the skip folder are not in the scan, even when it sits inside a watched folder.
  const folder = makeTempFolder(t, "snap-scan-");
  // write kept.txt and store/blob.txt, with store as the skip folder
  const keptPath = writeFileIn(folder, "kept.txt", "k");
  const skippedPath = writeFileIn(folder, "store/blob.txt", "b");
  const skipFolder = new Path(join(folder.toString(), "store"));
  const stamps = scanWatchedFolders([folder], [skipFolder],new Map());
  // only kept.txt is listed
  assert.equal(stamps.has(keptPath), true);
  assert.equal(stamps.has(skippedPath), false);
});

test("test_scanWatchedFolders_skips_every_folder_in_the_skip_list", (t) => {
  // Scenario: a second skip folder is left out too, and a file inside it is never read.
  const folder = makeTempFolder(t, "snap-scan-");
  // write kept.txt, store/blob.txt and cache/unreadable.txt, with store and cache as skip folders
  const keptPath = writeFileIn(folder, "kept.txt", "k");
  const storePath = writeFileIn(folder, "store/blob.txt", "b");
  const cachePath = writeFileIn(folder, "cache/unreadable.txt", "u");
  chmodSync(cachePath, 0o000);
  const skipFolders = [new Path(join(folder.toString(), "store")), new Path(join(folder.toString(), "cache"))];
  const stamps = scanWatchedFolders([folder], skipFolders, new Map());
  // only kept.txt is listed
  assert.equal(stamps.has(keptPath), true);
  assert.equal(stamps.has(storePath), false);
  assert.equal(stamps.has(cachePath), false);
});

test("test_scanWatchedFolders_skips_a_socket", async (t) => {
  // Scenario: a unix socket is neither stamped nor read.
  const folder = makeTempFolder(t, "snap-sock-");
  // listen on a socket inside the folder
  const socketPath = join(folder.toString(), "s.sock");
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  t.after(() => server.close());
  const stamps = scanWatchedFolders([folder], [makeTempFolder(t, "snap-skip-")], new Map());
  // the socket path is not in the scan
  assert.equal(stamps.has(socketPath), false);
});

test("test_scanWatchedFolders_copies_the_old_hash_when_the_stamp_is_unchanged", (t) => {
  // Scenario: an unchanged file is not read again; its hash comes from the previous scan.
  const folder = makeTempFolder(t, "snap-scan-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // scan once, then plant a fake hash in the previous scan
  const filePath = writeFileIn(folder, "a.txt", "hello");
  const previous = scanWatchedFolders([folder], [skipFolder],new Map());
  previous.get(filePath)!.contentHash = "sha256:fake";
  // scan again without touching the file
  const current = scanWatchedFolders([folder], [skipFolder],previous);
  // the fake hash is carried forward
  assert.equal(current.get(filePath)!.contentHash, "sha256:fake");
});

test("test_scanWatchedFolders_hashes_again_when_the_stamp_changed", (t) => {
  // Scenario: a file with a new stamp is read again, so a stale hash is replaced.
  const folder = makeTempFolder(t, "snap-scan-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // scan once, plant a fake hash, then rewrite the file with new content and a new mtime
  const filePath = writeFileIn(folder, "a.txt", "hello");
  const previous = scanWatchedFolders([folder], [skipFolder],new Map());
  previous.get(filePath)!.contentHash = "sha256:fake";
  writeFileIn(folder, "a.txt", "changed");
  utimesSync(filePath, new Date(2020, 0, 1), new Date(2020, 0, 1));
  const current = scanWatchedFolders([folder], [skipFolder],previous);
  // the new hash is the hash of the new content
  assert.equal(current.get(filePath)!.contentHash, hashOf("changed"));
});

test("test_scanWatchedFolders_stamps_a_folder_as_a_directory", (t) => {
  // Scenario: an empty folder appears as one directory entry with no hash.
  const folder = makeTempFolder(t, "snap-scan-");
  // make an empty sub folder, then scan
  const subFolder = join(folder.toString(), "sub");
  mkdirSync(subFolder);
  const stamps = scanWatchedFolders([folder], [makeTempFolder(t, "snap-skip-")], new Map());
  // the entry has kind directory and no hash
  assert.equal(stamps.get(subFolder)!.kind, FileKind.Directory);
  assert.equal(stamps.get(subFolder)!.contentHash, undefined);
});
