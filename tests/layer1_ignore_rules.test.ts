// Tests for the top-level .gitignore matcher used by the manual Layer 1 walk.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { isPathIgnored, readIgnoreRules } from "../src/layer1_ignore_rules.ts";

// A project folder whose .gitignore holds `gitignoreText`.
function makeProjectFolder(gitignoreText: string): Path {
    const root = mkdtempSync(join(tmpdir(), "layer1-ignore-rules-"));
    writeFileSync(join(root, ".gitignore"), gitignoreText);
    return new Path(root);
}

test("test_readIgnoreRules_returns_no_rules_without_a_gitignore", () => {
    const root = mkdtempSync(join(tmpdir(), "layer1-ignore-rules-bare-"));
    assert.deepEqual(readIgnoreRules(new Path(root)), []);
});

test("test_readIgnoreRules_skips_blanks_comments_and_negations", () => {
    const rules = readIgnoreRules(makeProjectFolder("# c\n\n!keep.log\nbuild/\n"));
    assert.equal(rules.length, 1);
    assert.equal(rules[0]?.directoriesOnly, true);
});

test("test_isPathIgnored_matches_directories_globs_and_anchored_paths", () => {
    const rules = readIgnoreRules(makeProjectFolder("build/\n*.log\n/top.txt\nsrc/gen.ts\n"));
    assert.equal(isPathIgnored("build", true, rules), true);
    assert.equal(isPathIgnored("build", false, rules), false);
    assert.equal(isPathIgnored("deep/debug.log", false, rules), true);
    assert.equal(isPathIgnored("top.txt", false, rules), true);
    assert.equal(isPathIgnored("nested/top.txt", false, rules), false);
    assert.equal(isPathIgnored("src/gen.ts", false, rules), true);
    assert.equal(isPathIgnored("other/gen.ts", false, rules), false);
});
