// Task 204 (spec S7): /webapp_old.html serves the old webapp page. Spawns the server because it listens at import.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
// Scratch ports avoid the default 7343. Use one port per spawn, never reuse: killed servers can linger.
let nextScratchPort = 17400 + (process.pid % 500);

// One launched viewer: the child to kill, and the port it listens on.
interface ViewerProcess {
    child: ChildProcess;
    port: number;
}

// Launch the viewer on a fresh scratch port against an empty projects dir.
function spawnViewerProcess(envOverride: NodeJS.ProcessEnv = {}, extraArgs: string[] = []): ViewerProcess {
    const emptyProjectsDir = mkdtempSync(join(tmpdir(), "viewer-server-test-"));
    const port = nextScratchPort++;
    const child = spawn(process.execPath, [
        "--import", "tsx", "src/viewer_server.ts",
        "--projects-dir", emptyProjectsDir,
        "--port", String(port),
        "--cache-file", join(mkdtempSync(join(tmpdir(), "viewer-server-cache-")), "cache.json"),
        ...extraArgs,
    ], {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "inherit"],
        env: { ...process.env, ...envOverride },
    });
    return { child, port };
}

// Signal readiness the way the server announces it: the "viewer listening" stdout line.
function markWhenListeningLineArrives(chunk: Buffer, markListening: () => void): void {
    if (chunk.toString().includes("viewer listening")) {
        markListening();
    }
}

function waitUntilListening(child: ChildProcess): Promise<void> {
    return new Promise((resolveStarted, rejectStarted) => {
        child.stdout?.on("data", (chunk: Buffer) => markWhenListeningLineArrives(chunk, resolveStarted));
        child.on("exit", (code) => rejectStarted(new Error(`server exited early: ${code}`)));
    });
}

async function fetchPageText(port: number, urlPath: string): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`);
    assert.equal(response.status, 200);
    return response.text();
}

// A fake `osascript` first on PATH replaces the folder dialog: call 1 picks a folder, call 2 cancels.
const PICKED_FOLDER = "/Users/test/picked folder";

function writeFakeOsascriptDir(): string {
    const fakeDir = mkdtempSync(join(tmpdir(), "viewer-osascript-"));
    // Trailing slash mirrors real `POSIX path of`, so this also covers the handler's slash trim.
    writeFileSync(join(fakeDir, "osascript"), [
        "#!/bin/sh",
        `if [ -e "${fakeDir}/called" ]; then exit 1; fi`,
        `: > "${fakeDir}/called"`,
        `printf '%s\\n' '${PICKED_FOLDER}/'`,
        "",
    ].join("\n"), { mode: 0o755 });
    return fakeDir;
}

async function fetchPickedFolderPath(port: number): Promise<string> {
    return JSON.parse(await fetchPageText(port, "/api/pick-folder")).path;
}

test("test_pick_folder_returns_the_dialog_path_and_empty_string_on_cancel", async () => {
    // Scenario: [Open…] hits /api/pick-folder; the dialog reports a folder, then the user cancels.
    const fakeDir = writeFakeOsascriptDir();
    const viewer = spawnViewerProcess({ PATH: `${fakeDir}:${process.env.PATH}` });
    try {
        await waitUntilListening(viewer.child);
        assert.equal(await fetchPickedFolderPath(viewer.port), PICKED_FOLDER);
        // Cancel is osascript exit -128 — a clean "no selection", never an error status.
        assert.equal(await fetchPickedFolderPath(viewer.port), "");
    } finally {
        viewer.child.kill();
    }
});

test("test_settings_file_flag_makes_the_server_read_that_file_not_the_home_one", async () => {
    // Scenario: a visual harness passes --settings-file so the user's real settings never shape its run.
    const settingsFile = join(mkdtempSync(join(tmpdir(), "viewer-settings-file-")), "settings.json");
    writeFileSync(settingsFile, JSON.stringify({ lastDir: "/flag-only-dir", projects: {} }));
    const viewer = spawnViewerProcess({}, ["--settings-file", settingsFile]);
    try {
        await waitUntilListening(viewer.child);
        const settings = JSON.parse(await fetchPageText(viewer.port, "/api/layer1-settings"));
        assert.equal(settings.lastDir, "/flag-only-dir");
    } finally {
        viewer.child.kill();
    }
});

test("webapp_old_html_serves_the_preexisting_page", async () => {
    const viewer = spawnViewerProcess();
    try {
        await waitUntilListening(viewer.child);
        const oldPageHtml = await fetchPageText(viewer.port, "/webapp_old.html");
        assert.ok(oldPageHtml.includes("JSONL File Reverse Engineer Debugger"));
        // The layered page (task 205) claimed index.html, so `/` serves it instead.
        const rootHtml = await fetchPageText(viewer.port, "/");
        assert.ok(rootHtml.includes("JFRED — Layered Timeline"));
    } finally {
        viewer.child.kill();
    }
});
