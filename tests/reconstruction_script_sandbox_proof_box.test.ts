import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path } from "../src/structures/domain.ts";
import { chooseSandboxMount } from "../src/reconstruction_script_sandbox_docker.ts";
import { NO_SUCH_FILE, PROOF_TIMEOUT_MS, runProofScript } from "./reconstruction_script_sandbox_proof_helpers.ts";

test("test_proof_5_network_is_closed_to_the_internet_and_to_the_host", { timeout: PROOF_TIMEOUT_MS }, async () => {
    let connectionCount = 0;
    const server: Server = createServer((socket) => {
        connectionCount++;
        socket.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const hostPort = (server.address() as { port: number }).port;
    const script = [
        "import socket",
        `targets = [("1.1.1.1", 53), ("127.0.0.1", ${hostPort}), ("host.docker.internal", ${hostPort})]`,
        "for target in targets:",
        "    try:",
        "        socket.create_connection(target, timeout=2).close()",
        '        print("CONNECTED", target)',
        "    except OSError as error:",
        '        print("BLOCKED", target[0], type(error).__name__)',
        "",
    ].join("\n");
    try {
        const run = await runProofScript(script);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(run.status, 0, run.stderr);
        assert.ok(!run.stdout.includes("CONNECTED"), run.stdout);
        assert.equal(run.stdout.split("\n").filter((line) => line.startsWith("BLOCKED")).length, 3, run.stdout);
        assert.equal(connectionCount, 0);
    }
    finally {
        server.close();
    }
});

test("test_proof_6_a_host_program_cannot_be_started", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const hostDir = mkdtempSync(join(tmpdir(), "reveng-proof-prog-"));
    const marker = join(hostDir, "marker.txt");
    const hostProgram = join(hostDir, "host.sh");
    writeFileSync(hostProgram, `#!/bin/sh\necho ran > ${marker}\n`);
    chmodSync(hostProgram, 0o755);
    const run = await runProofScript(`import subprocess\nsubprocess.run([${JSON.stringify(hostProgram)}])\nprint("PROGRAM-STARTED")\n`);
    assert.notEqual(run.status, 0);
    assert.ok(!run.stdout.includes("PROGRAM-STARTED"));
    assert.match(run.stderr, NO_SUCH_FILE);
    assert.ok(run.stderr.includes(hostProgram), run.stderr);
    assert.ok(!existsSync(marker));
});

test("test_proof_7_a_host_environment_variable_is_not_visible_inside", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const secretName = "REVENG_PROOF_SECRET";
    const secretValue = `secret-${randomUUID()}`;
    process.env[secretName] = secretValue;
    try {
        const script = [
            "import os",
            `print("DIRECT=" + repr(os.environ.get(${JSON.stringify(secretName)})))`,
            `print("ANYWHERE=" + str(any(${JSON.stringify(secretValue)} in value for value in os.environ.values())))`,
            "",
        ].join("\n");
        const run = await runProofScript(script);
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout, "DIRECT=None\nANYWHERE=False\n");
        assert.ok(!run.stderr.includes(secretValue));
    }
    finally {
        delete process.env[secretName];
    }
});

test("test_proof_8_a_colon_in_the_recorded_cwd_cannot_change_the_mount", { timeout: PROOF_TIMEOUT_MS }, async () => {
    for (const cwd of ["/work:ro", "/work:/etc", "/a:b", "/work:rw,bind-propagation=rshared"]) {
        assert.throws(() => chooseSandboxMount(new Path(cwd)), /colon/, cwd);
    }
    // Docker reads the text after the colon as a mode, so the raw command fails.
    const rawRun = await runProofScript('print("RAN")\n', new Path("/work:ro"));
    assert.notEqual(rawRun.status, 0);
    assert.ok(!rawRun.stdout.includes("RAN"));
    assert.match(rawRun.stderr, /can't open file '\/work:ro\/__script__\.py'/);
});
