import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Path, Uuid } from "../src/structures/domain.ts";
import {
  DEFAULT_SANDBOX_MOUNT,
  SANDBOX_IMAGE,
  DockerUnavailableError,
  assertSandboxImagePresent,
  buildDockerRunArgs,
  chooseSandboxMount,
  killSandboxContainer,
} from "../src/reconstruction_script_sandbox_docker.ts";

test("test_buildDockerRunArgs_returns_the_closed_box_command", () => {
    const runId = new Uuid("run-1");
    const args = buildDockerRunArgs(runId, new Path("/tmp/seed"), new Path("/Users/me/proj"));
    assert.deepEqual(args, [
        "run", "--rm", "--pull", "never", "--network", "none",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "1g",
        "--name", "run-1", "-v", "/tmp/seed:/Users/me/proj", "-w", "/Users/me/proj",
        "python:3.14-slim", "python3", "__script__.py",
    ]);
});

test("test_buildDockerRunArgs_passes_the_hardening_flags", () => {
    const args = buildDockerRunArgs(new Uuid("run-2"), new Path("/tmp/seed"), new Path("/work"));
    const flagPairs: [string, string][] = [
        ["--cap-drop", "ALL"],
        ["--security-opt", "no-new-privileges"],
        ["--pids-limit", "256"],
        ["--memory", "1g"],
        ["--network", "none"],
        ["--pull", "never"],
    ];
    for (const [flag, value] of flagPairs) {
        assert.equal(args[args.indexOf(flag) + 1], value, flag);
    }
});

test("test_SANDBOX_IMAGE_is_the_python_3_14_slim_tag", () => {
    assert.equal(SANDBOX_IMAGE, "python:3.14-slim");
    assert.equal(DEFAULT_SANDBOX_MOUNT.toString(), "/work");
});

test("test_chooseSandboxMount_returns_recorded_cwd_or_work", () => {
    assert.equal(chooseSandboxMount(new Path("/Users/me/proj")).toString(), "/Users/me/proj");
    assert.equal(chooseSandboxMount(undefined).toString(), "/work");
});

test("test_chooseSandboxMount_throws_on_a_colon_in_the_recorded_cwd", () => {
    for (const cwd of ["/work:ro", "/a:b", "/work:/etc", "/a:b:c"]) {
        assert.throws(() => chooseSandboxMount(new Path(cwd)), /colon/, cwd);
    }
});

test("test_assertSandboxImagePresent_passes_when_docker_has_the_image", () => {
    assertSandboxImagePresent();
});

test("test_assertSandboxImagePresent_throws_the_plain_text_when_docker_is_missing", () => {
    const savedPath = process.env.PATH;
    process.env.PATH = "";
    try {
        assert.throws(
            () => assertSandboxImagePresent(),
            (error: Error) =>
                error instanceof DockerUnavailableError &&
                error.message === "Docker is off or the image python:3.14-slim is missing",
        );
    }
    finally {
        process.env.PATH = savedPath;
    }
});

test("test_killSandboxContainer_ignores_a_container_that_does_not_exist", () => {
    killSandboxContainer(new Uuid(`reveng-test-missing-${randomUUID()}`));
});

test("test_killSandboxContainer_stops_a_running_container", { timeout: 60000 }, async () => {
    const runId = new Uuid(`reveng-test-kill-${randomUUID()}`);
    const child = spawn("docker", ["run", "--rm", "--pull", "never", "--network", "none", "--name", runId.toString(), SANDBOX_IMAGE, "sleep", "60"], { stdio: "pipe" });
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    for (let attempt = 0; attempt < 100; attempt++) {
        const state = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", runId.toString()], { encoding: "utf8" });
        if (state.stdout.trim() === "true") {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    killSandboxContainer(runId);
    assert.notEqual(await exited, 0);
    const after = spawnSync("docker", ["inspect", runId.toString()], { encoding: "utf8" });
    assert.notEqual(after.status, 0);
});
