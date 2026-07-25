// Server test for task 204 (spec S7): `/webapp_old.html` serves the pre-existing webapp page.
// viewer_server.ts starts listening at import time, so this is a spawned-process test rather
// than an import test: launch the server on a scratch port, fetch, assert, kill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
// A port far from the app default (7343) so the test never collides with a running viewer.
const SCRATCH_PORT = 17400 + (process.pid % 500);

// Launch the viewer on SCRATCH_PORT against an empty projects dir.
function spawnViewerProcess(): ChildProcess {
    const emptyProjectsDir = mkdtempSync(join(tmpdir(), "viewer-server-test-"));
    return spawn(process.execPath, [
        "--import", "tsx", "src/viewer_server.ts",
        "--projects-dir", emptyProjectsDir,
        "--port", String(SCRATCH_PORT),
    ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "inherit"] });
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

async function fetchPageText(urlPath: string): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}${urlPath}`);
    assert.equal(response.status, 200);
    return response.text();
}

test("webapp_old_html_serves_the_preexisting_page", async () => {
    const child = spawnViewerProcess();
    try {
        await waitUntilListening(child);
        const oldPageHtml = await fetchPageText("/webapp_old.html");
        assert.ok(oldPageHtml.includes("JSONL File Reverse Engineer Debugger"));
        // The layered page (task 205) claimed index.html, so `/` serves it instead.
        const rootHtml = await fetchPageText("/");
        assert.ok(rootHtml.includes("JFRED — Layered Timeline"));
    } finally {
        child.kill();
    }
});
