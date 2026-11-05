// Real Docker, one tiny script. Runs only after the proof gate is green.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import type { SandboxBox } from "../src/reconstruction_script_sandbox_box.ts";
import { executeSandboxStreaming, type OutputStream } from "../src/reconstruction_script_sandbox_stream.ts";

const TEST_OPTIONS = { timeout: 90000 };

test("test_executeSandboxStreaming_with_a_box_streams_output_lines_and_writes_the_redirect_file", TEST_OPTIONS, async () => {
    // Box run: stdout lines reach the sink and the redirect file is saved.
    const box: SandboxBox = {
        root: new Path("/proj"),
        workdir: new Path("/proj/sub"),
        scriptPath: new Path("/proj/sub/gen.py"),
        stdoutRedirect: { target: new Path("log.txt"), appends: false },
        project: undefined,
    };
    // the script prints two lines.
    const script = 'print("one", flush=True)\nprint("two")\n';
    const chunks: [OutputStream, string][] = [];
    const result = await executeSandboxStreaming(script, new Map(), new Path("/proj/sub"), (stream, text) => chunks.push([stream, text]), new AbortController().signal, 25000, box);
    // the sink got both lines, as stdout.
    assert.equal(chunks.map(([, text]) => text).join(""), "one\ntwo\n");
    assert.equal(chunks[0]![0], "stdout");
    // the run reports a clean exit.
    assert.equal(result.output.exitCode, 0);
    // the post state holds the redirect file with the stdout text, and not the script file.
    assert.deepEqual([...result.post!], [["log.txt", "one\ntwo\n"]]);
});
