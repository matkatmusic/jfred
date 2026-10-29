import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGitFileDiff } from "../src/reconstruction_render_git_patch.ts";

test("test_git_patch_replaces_whole_file_with_one_hunk", () => {
  const out = renderGitFileDiff("a.txt", "one\ntwo\n", "three\n");
  assert.equal(
    out,
    "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,1 @@\n-one\n-two\n+three\n",
  );
});

test("test_git_patch_marks_creation_with_dev_null_old_side", () => {
  const out = renderGitFileDiff("a.txt", undefined, "x\n");
  assert.equal(
    out,
    "diff --git a/a.txt b/a.txt\nnew file mode 100644\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1,1 @@\n+x\n",
  );
});

test("test_git_patch_marks_deletion_with_dev_null_new_side", () => {
  const out = renderGitFileDiff("a.txt", "x\n", undefined);
  assert.equal(
    out,
    "diff --git a/a.txt b/a.txt\ndeleted file mode 100644\n--- a/a.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n",
  );
});

test("test_git_patch_empty_creation_is_header_only", () => {
  const out = renderGitFileDiff("a.txt", undefined, "");
  assert.equal(out, "diff --git a/a.txt b/a.txt\nnew file mode 100644\n");
});

test("test_git_patch_adds_no_newline_marker_when_text_lacks_trailing_newline", () => {
  const out = renderGitFileDiff("a.txt", "x", "y");
  assert.ok(out.includes("-x\n\\ No newline at end of file\n+y\n\\ No newline at end of file\n"));
});
