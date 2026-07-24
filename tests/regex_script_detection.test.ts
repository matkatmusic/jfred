// Direct tests for the task-139 shell write-primitive pattern (the python patterns in this
// module are exercised end-to-end through tests/reconstruction_script_prestate.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { shellWritePrimitive } from "../src/regex_script_detection.ts";

test("test_shellWritePrimitive_matches_write_verbs_and_file_redirects", () => {
    // Scenario (task 139): each shell write channel the gate must flag — a write-verb word,
    // `sed -i`, and an output redirect whose target looks like a file path.
    assert.equal(shellWritePrimitive.test("mv a.py b.py"), true);
    assert.equal(shellWritePrimitive.test("sed -i 's/a/b/' config.py"), true);
    assert.equal(shellWritePrimitive.test("echo hi > out.txt"), true);
    assert.equal(shellWritePrimitive.test("python3 check.py >> logs/run.log"), true);
});

test("test_shellWritePrimitive_ln_word_requires_command_position", () => {
    // Scenario (task 192, optimizations.md Phase 2): the `ln` word must match only as a real
    // command, never as the tail of an option cluster or an identifier.
    // Steps:
    // `grep -ln pattern file` is a read-only search — the `ln` letters sit inside `-ln`.
    assert.equal(shellWritePrimitive.test("grep -ln pattern file"), false);
    // `grep -n pattern file` is read-only too (guard: the split must not loosen `-n`).
    assert.equal(shellWritePrimitive.test("grep -n pattern file"), false);
    // A real `ln -s` creates a link — may-write.
    assert.equal(shellWritePrimitive.test("ln -s target link"), true);
    // An absolute-path invocation is still the ln command — may-write.
    assert.equal(shellWritePrimitive.test("/bin/ln target link"), true);
    // `println(...)` is an identifier, not a shell ln command.
    assert.equal(shellWritePrimitive.test('println("x")'), false);
});

test("test_shellWritePrimitive_ignores_read_only_probe_shapes", () => {
    // Scenario (task 139 guard): fd dups, /dev/null redirects, and plain probe commands carry
    // no write channel — they must stay unmatched so the item-68 sandbox skip keeps firing.
    assert.equal(shellWritePrimitive.test("grep -n def ledger.py 2>&1"), false);
    assert.equal(shellWritePrimitive.test("pytest -q 2>/dev/null"), false);
    assert.equal(shellWritePrimitive.test("ls -la"), false);
    assert.equal(shellWritePrimitive.test("cat ledger.py | head -20"), false);
});
