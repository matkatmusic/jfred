// Extraction reads transcript records directly, not the consent scan's ScriptRun list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { GitOperationKind } from "../src/structures/vocabulary.ts";
import { S6_JSONL, S19_JSONL, S39_JSONL_PATHS, S41_JSONL_PATHS, S85_JSONL_PATHS } from "./fixtures.ts";

test("test_s39_git_operations_are_init_then_add", () => {
    // s39's prompt mentions commit/branch as prose only; those were never executed.
    const document = buildProjectDocument(S39_JSONL_PATHS, undefined);
    assert.deepEqual(
        document.gitOperations.map((operation) => operation.kind),
        [GitOperationKind.init, GitOperationKind.add],
    );
    assert.deepEqual(
        document.gitOperations.map((operation) => operation.detail),
        ["", "orders.py tests/"],
    );
    // The { } button resolves the command's JSONL line through the Bash record's own uuid.
    assert.equal(document.gitOperations[0]!.command, "git init");
    assert.equal(document.gitOperations[1]!.command, "git add orders.py tests/");
    for (const operation of document.gitOperations) {
        assert.ok(operation.timestamp instanceof Date);
        assert.ok(operation.sessionId instanceof Uuid);
        assert.ok(operation.uuid instanceof Uuid);
    }
});

test("test_s85_commit_operations_carry_their_messages", () => {
    // s85 uses `git -C <path> <subcommand>`, so parsing must skip global flags and their arguments.
    const document = buildProjectDocument(S85_JSONL_PATHS, undefined);
    assert.deepEqual(
        document.gitOperations.map((operation) => operation.kind),
        [
            GitOperationKind.init,
            GitOperationKind.add,
            GitOperationKind.commit,
            GitOperationKind.add,
            GitOperationKind.commit,
        ],
    );
    const commits = document.gitOperations.filter(
        (operation) => operation.kind === GitOperationKind.commit,
    );
    assert.deepEqual(
        commits.map((operation) => operation.detail),
        ["baseline", "post-rename"],
    );
    // The -C dir is a flag argument, and `add -A` has no paths.
    const adds = document.gitOperations.filter(
        (operation) => operation.kind === GitOperationKind.add,
    );
    assert.deepEqual(
        adds.map((operation) => operation.detail),
        ["one.py two.py three.py", ""],
    );
});

test("test_s41_two_session_git_operations_include_branch_creation", () => {
    // Sequence pinned from a live capture of this document, 2026-07-08.
    const document = buildProjectDocument(S41_JSONL_PATHS, undefined);
    assert.deepEqual(
        document.gitOperations.map((operation) => operation.kind),
        [
            GitOperationKind.init,
            GitOperationKind.add,
            GitOperationKind.commit,
            GitOperationKind.checkout,
            GitOperationKind.add,
            GitOperationKind.commit,
        ],
    );
    // findFirstNonFlagArgument must skip the `-b` flag to reach the branch name.
    const checkouts = document.gitOperations.filter(
        (operation) => operation.kind === GitOperationKind.checkout,
    );
    assert.equal(checkouts.length, 1);
    assert.equal(checkouts[0]!.detail, "feature");
    assert.equal(checkouts[0]!.command, "git checkout -b feature");
    assert.deepEqual(
        document.gitOperations
            .filter((operation) => operation.kind === GitOperationKind.commit)
            .map((operation) => operation.detail),
        ["baseline", "wip"],
    );
});

test("test_s6_compound_add_and_commit_each_get_an_operation", () => {
    // Each segment of a compound `git add … && git commit …` must yield its own operation.
    const document = buildProjectDocument([new Path(S6_JSONL)], undefined);
    assert.deepEqual(
        document.gitOperations.map((operation) => operation.kind),
        [
            GitOperationKind.init, GitOperationKind.add, GitOperationKind.commit,
            GitOperationKind.add, GitOperationKind.commit, GitOperationKind.other,
        ],
    );
    // The compound add's detail must stop at its own segment.
    assert.equal(document.gitOperations[1]!.detail, "s6_git.py tests/test_s6_git.py");
});

test("test_s6_failed_compound_git_command_stamps_isError_on_its_operations", () => {
    // Failed segments still emit operations, stamped isError so the timeline can badge them FAILED.
    const document = buildProjectDocument([new Path(S6_JSONL)], undefined);
    assert.deepEqual(
        document.gitOperations.map((operation) => operation.isError),
        [undefined, true, true, undefined, undefined, undefined],
    );
});

test("test_s19_without_git_yields_no_operations", () => {
    // With no git operations the timeline renders no git rows and derives no commit hard-stops.
    const document = buildProjectDocument([new Path(S19_JSONL)], undefined);
    assert.deepEqual(document.gitOperations, []);
});

