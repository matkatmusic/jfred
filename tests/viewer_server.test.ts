// Server test for task 204 (spec S7): `/webapp_old.html` serves the pre-existing webapp page.
// viewer_server.ts starts listening at import time, so this is a spawned-process test rather
// than an import test: launch the server on a scratch port, fetch, assert, kill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
// Ports far from the app default (7343) so the tests never collide with a running viewer.
// One port PER SPAWN, never reused: a killed child can linger (an attached debugger holds it
// in "waiting for the debugger to disconnect"), so no test may wait on a previous server's
// exit or rebind its port.
let nextScratchPort = 17400 + (process.pid % 500);

// One launched viewer: the child to kill, and the port it listens on.
interface ViewerProcess {
    child: ChildProcess;
    port: number;
}

// Launch the viewer on a fresh scratch port against an empty projects dir.
function spawnViewerProcess(envOverride: NodeJS.ProcessEnv = {}): ViewerProcess {
    const emptyProjectsDir = mkdtempSync(join(tmpdir(), "viewer-server-test-"));
    const port = nextScratchPort++;
    const child = spawn(process.execPath, [
        "--import", "tsx", "src/viewer_server.ts",
        "--projects-dir", emptyProjectsDir,
        "--port", String(port),
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

// The picker shells out to `osascript` found on PATH, so a temp dir holding a fake `osascript`
// (prepended to PATH) stands in for the GUI dialog — no real chooser ever opens. The fake is
// stateful on purpose: call 1 = the user picked a folder, call 2 = the user cancelled, which
// exercises both branches against ONE server.
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
