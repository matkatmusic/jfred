import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectBoxPostState, collectSandboxFileHashes } from "../src/reconstruction_script_sandbox_snapshot.ts";
import type { SandboxBox } from "../src/reconstruction_script_sandbox_box.ts";
import { Path } from "../src/structures/domain.ts";

function makeBox(workdir: string): SandboxBox {
  return { root: new Path("/proj"), workdir: new Path(workdir), scriptPath: new Path(`${workdir}/__script__.py`), stdoutRedirect: undefined, project: undefined };
}

function writeTempFiles(tempDir: string, files: Record<string, string | Buffer>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(dirname(join(tempDir, relativePath)), { recursive: true });
    writeFileSync(join(tempDir, relativePath), content);
  }
}

function makeTempDir(files: Record<string, string | Buffer>): string {
  const tempDir = mkdtempSync(join(tmpdir(), "reveng-snapshot-lists-"));
  writeTempFiles(tempDir, files);
  return tempDir;
}

test("test_collectBoxPostState_lists_a_deleted_clone_file", () => {
  // Scenario: workdir /proj/sub; the run deletes sub/gone.txt and other/gone2.txt, which are only in the baseline.
  const tempDir = makeTempDir({ "sub/gone.txt": "g", "other/gone2.txt": "g2", "sub/kept.txt": "k" });
  try {
    const baseline = collectSandboxFileHashes(tempDir);
    rmSync(join(tempDir, "sub/gone.txt"));
    rmSync(join(tempDir, "other/gone2.txt"));
    const { deletedKeys } = collectBoxPostState(tempDir, makeBox("/proj/sub"), new Map(), baseline);
    assert.deepEqual(deletedKeys.sort(), ["../other/gone2.txt", "gone.txt"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("test_collectBoxPostState_lists_a_changed_file_that_is_not_text", () => {
  // Scenario: the run changes a binary file; it is in notTextKeys and not in post.
  const tempDir = makeTempDir({ "data.bin": Buffer.from([0x01, 0x02]) });
  try {
    const baseline = collectSandboxFileHashes(tempDir);
    writeTempFiles(tempDir, { "data.bin": Buffer.from([0xff, 0xfe]), "note.txt": "text" });
    const { post, notTextKeys } = collectBoxPostState(tempDir, makeBox("/proj"), new Map(), baseline);
    assert.deepEqual(notTextKeys, ["data.bin"]);
    assert.equal(post.has("data.bin"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("test_collectBoxPostState_never_lists_the_script_file_as_deleted", () => {
  // Scenario: the run removes its own script file; deletedKeys stays empty.
  const tempDir = makeTempDir({ "__script__.py": "print(1)", "gone.txt": "g" });
  try {
    const baseline = collectSandboxFileHashes(tempDir);
    rmSync(join(tempDir, "__script__.py"));
    rmSync(join(tempDir, "gone.txt"));
    const { deletedKeys } = collectBoxPostState(tempDir, makeBox("/proj"), new Map(), baseline);
    assert.deepEqual(deletedKeys, ["gone.txt"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
