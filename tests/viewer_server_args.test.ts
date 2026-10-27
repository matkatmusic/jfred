// parseServerArgs: --projects-dir is mandatory, the port defaults to 7343, and reset flags pass through.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseServerArgs } from "../src/viewer_server_args.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

test("test_parse_server_args_requires_projects_dir", () => {
    assert.throws(() => parseServerArgs([]), /usage: tsx src\/viewer_server.ts/);
    assert.throws(() => parseServerArgs(["--projects-dir"]), /usage:/);
});

test("test_parse_server_args_defaults_port_and_reset_flags", () => {
    assert.deepEqual(parseServerArgs(["--projects-dir", makeTempDir()]), {
        port: 7343,
        resetSandboxMemo: false,
        resetDocumentCache: false,
    });
});

test("test_parse_server_args_reads_port_and_reset_flags", () => {
    const parsed = parseServerArgs(["--projects-dir", makeTempDir(), "--port", "18123", "--resetSandboxMemo", "--resetDocumentCache"]);
    assert.deepEqual(parsed, { port: 18123, resetSandboxMemo: true, resetDocumentCache: true });
});

test("test_parse_server_args_rejects_a_non_integer_port", () => {
    assert.throws(() => parseServerArgs(["--projects-dir", makeTempDir(), "--port", "abc"]), /usage:/);
    assert.throws(() => parseServerArgs(["--projects-dir", makeTempDir(), "--port"]), /usage:/);
});
