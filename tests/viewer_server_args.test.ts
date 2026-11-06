// parseServerArgs: --projects-dir is mandatory, the port defaults to 7343, and reset flags pass through.

import assert from "node:assert/strict";
// import { readFileSync } from "node:fs";
// import { join } from "node:path";
import { test } from "node:test";
import { parseServerArgs } from "../src/viewer_server_args.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

test("test_parse_server_args_requires_projects_dir", () => {
    assert.throws(() => parseServerArgs([]), /usage: tsx src\/viewer_server.ts/);
    assert.throws(() => parseServerArgs(["--projects-dir"]), /usage:/);
});

test("test_parse_server_args_defaults_port_and_reset_flags", () => {
    assert.deepEqual(parseServerArgs(["--projects-dir", createTempDir()]), {
        port: 7343,
        resetSandboxMemo: false,
        resetDocumentCache: false,
        sandboxMemoFile: undefined,
    });
});

test("test_parse_server_args_reads_port_and_reset_flags", () => {
    const parsed = parseServerArgs(["--projects-dir", createTempDir(), "--port", "18123", "--resetSandboxMemo", "--resetDocumentCache"]);
    assert.deepEqual(parsed, { port: 18123, resetSandboxMemo: true, resetDocumentCache: true, sandboxMemoFile: undefined });
});

test("test_parse_server_args_reads_the_sandbox_memo_file_flag", () => {
    const parsed = parseServerArgs(["--projects-dir", createTempDir(), "--sandbox-memo-file", "/tmp/memo.json"]);
    assert.equal(parsed.sandboxMemoFile, "/tmp/memo.json");
});

// not behavior: it only greps the server source text for a string constant.
// test("test_viewer_server_default_memo_file_is_sandbox_memo_docker_json", () => {
//     const serverSource = readFileSync(join(import.meta.dirname, "..", "src", "viewer_server.ts"), "utf8");
//     assert.ok(serverSource.includes('"sandbox-memo-docker.json"'));
//     assert.ok(!serverSource.includes('"sandbox-memo.json"'));
// });

test("test_parse_server_args_rejects_a_non_integer_port", () => {
    assert.throws(() => parseServerArgs(["--projects-dir", createTempDir(), "--port", "abc"]), /usage:/);
    assert.throws(() => parseServerArgs(["--projects-dir", createTempDir(), "--port"]), /usage:/);
});
