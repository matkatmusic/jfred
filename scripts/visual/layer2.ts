// Task 318: the Layer 2 checks, re-pointed from the mockup at the REAL page with REAL data.
//
// It boots the real viewer_server.ts against the DEMO bundle (transcripts that carry snapshots).
//
// Checks: the [2] toggle, the 📸 nodes, the snapshot ruler rows, and the snapshot drawer.
//
// Expected counts come from the same /api/layer1-view payload the page renders, never hard-coded.

import { spawn, execFileSync, execSync, type ChildProcess } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, openHeadlessPage, pause, waitForHttp, type HeadlessPage } from "./cdp.ts";
import { runLayer2Checks, type ViewPayload } from "./layer2-checks.ts";
import { check, failures } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEMO_DIR = join(JFRED_ROOT, "demo");
const JSONL_DIR = join(DEMO_DIR, "projects", "s87-demo-composite");

// The absolute prefix the demo transcripts recorded their files under; a snapshot only attaches to a pair when the on-disk `dir` shares this prefix, so the working tree is materialised HERE.
const RECORDED_PREFIX = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.7y52smqe";
const VIEW_REF = "feature";

const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;

function killPort(port: number): void {
    execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

function buildWebapp(): void {
    execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
}

// Rebuild the demo working tree at the recorded prefix from repo.git.tar, so `dir` and the recorded snapshot paths share a prefix. Idempotent: a stale tree from a previous run is discarded first.
function materializeDemoWorktree(): void {
    rmSync(RECORDED_PREFIX, { recursive: true, force: true });
    mkdirSync(RECORDED_PREFIX, { recursive: true });
    execFileSync("tar", ["xf", join(DEMO_DIR, "repo.git.tar"), "-C", RECORDED_PREFIX]);
    execFileSync("git", ["-C", RECORDED_PREFIX, "checkout", "-f", VIEW_REF, "--", "."]);
}

function viewUrl(port: number): string {
    const params = new URLSearchParams({ dir: RECORDED_PREFIX, repo: RECORDED_PREFIX, ref: VIEW_REF });
    params.append("jsonl", JSONL_DIR);
    return `http://127.0.0.1:${port}/app/layer1.html?${params}`;
}

async function startViewer(port: number): Promise<ChildProcess> {
    const server = spawn("node_modules/.bin/tsx", [
        "src/viewer_server.ts", "--projects-dir", join(DEMO_DIR, "projects"), "--port", String(port),
    ], { cwd: JFRED_ROOT, stdio: "ignore" });
    await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
    return server;
}

// The payload the page itself renders; the driver reads it to derive every expected count.
async function fetchViewPayload(port: number): Promise<ViewPayload> {
    const params = new URLSearchParams({ dir: RECORDED_PREFIX, repo: RECORDED_PREFIX, ref: VIEW_REF });
    params.append("jsonl", JSONL_DIR);
    const response = await fetch(`http://127.0.0.1:${port}/api/layer1-view?${params}`);
    return await response.json() as ViewPayload;
}

async function driveAndCheck(port: number, payload: ViewPayload): Promise<void> {
    const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    try {
        await page.navigate(viewUrl(port));
        await page.waitFor("document.querySelectorAll('#stage .filebox').length > 0", 40_000);
        await runLayer2Checks(page as HeadlessPage, payload);
    } finally {
        await page.close();
    }
}

async function main(): Promise<void> {
    buildWebapp();
    materializeDemoWorktree();
    const port = await findFreePort();
    killPort(port);
    const server = await startViewer(port);
    try {
        const payload = await fetchViewPayload(port);
        const snapTotal = payload.pairs.reduce((n, p) => n + (p.snapshots?.length ?? 0), 0)
            + payload.diskOrphans.reduce((n, o) => n + (o.snapshots?.length ?? 0), 0);
        check("#318 the demo fixture ships file-history snapshots to verify against", snapTotal > 0, snapTotal);
        await driveAndCheck(port, payload);
    } finally {
        server.kill("SIGKILL");
        await pause(200);
        killPort(port);
    }
    console.log(failures.length
        ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
        : "\nALL LAYER 2 CHECKS PASSED — screenshots in scripts/visual/out/");
    process.exit(failures.length ? 1 : 0);
}

await main();
