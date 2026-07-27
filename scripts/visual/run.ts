// The Layer 1 visual verification loop, end to end and from cold: build the webapp, kill whatever
// holds the viewer port, start a fresh viewer on a free one, drive headless Chrome through every
// scripted state capturing a screenshot and a geometry dump at each, then run the assertion layer
// over those dumps.
//
// Usage:  node --import tsx scripts/visual/run.ts [label]
// Artifacts land in scripts/visual/out/<label>/ and the exit code is the verdict — 0 clean, 1 on any
// violation — so the loop can be re-run until it passes without reading its output.

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeLayer1Defaults } from "../../src/viewer_api_layer1_defaults.ts";
import { checkStateGeometry, type Violation } from "./assertions.ts";
import { findFreePort, openHeadlessPage, pause, waitForHttp } from "./cdp.ts";
import { GEOMETRY_PROBE, type StateGeometry } from "./geometry.ts";
import { VISUAL_STATES } from "./states.ts";

// The port the project's own `npm run app` uses. Killed before every run because a stale viewer
// still answering there has repeatedly been mistaken for the feature being broken.
const CONVENTIONAL_PORT = 7343;

// 1600x1000 is a real laptop viewport. The window matters: every assertion about what is on screen
// is measured against it, so changing it changes what "off screen" means.
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Layer 1 compares a working tree against a git repo, so this repo is its own real-data fixture:
// ~800 pair bubbles across a ~156,000 px stage, which is the render every reported bug came from.
// debugConfig.json, when present, is what the browser opens on — so the harness opens on it too
// (user, 2026-07-27), or the two verify different renders. Absent, this falls back to the repo
// itself, which is what it always used.
const DEBUG_DEFAULTS = computeLayer1Defaults();
const VIEW_DIR = DEBUG_DEFAULTS.dir ?? JFRED_ROOT;
const VIEW_REPO = DEBUG_DEFAULTS.repo ?? JFRED_ROOT;

// The viewer requires a projects dir even though Layer 1 reads none; the checked-in demo bundle
// keeps a cold start off the user's live ~/.claude/projects.
const PROJECTS_DIR = join(JFRED_ROOT, "demo", "projects");

function killPort(port: number): void {
    execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

// Compile webapp/*.ts into webapp/dist, so a renderer edit is actually in the page being driven.
// Without this the loop would verify the PREVIOUS build and report a fix that never shipped.
function buildWebapp(): void {
    execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
}

async function startViewer(port: number): Promise<ChildProcess> {
    const server = spawn("node_modules/.bin/tsx", [
        "src/viewer_server.ts", "--projects-dir", PROJECTS_DIR, "--port", String(port),
    ], { cwd: JFRED_ROOT, stdio: "ignore" });
    await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
    return server;
}

export function buildViewUrl(port: number): string {
    const params = new URLSearchParams({ dir: VIEW_DIR, repo: VIEW_REPO });
    return `http://127.0.0.1:${port}/app/layer1.html?${params}`;
}

// One state's two artifacts. The PNG is what the user reads; the JSON is what the assertions read.
async function captureState(
    page: Awaited<ReturnType<typeof openHeadlessPage>>,
    outDir: string,
    name: string,
): Promise<StateGeometry> {
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(await page.screenshot(), "base64"));
    const geometry = { ...await page.evaluate<StateGeometry>(GEOMETRY_PROBE), state: name };
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(geometry));
    return geometry;
}

// Drive every state in order, capturing as each one lands.
async function captureAllStates(port: number, outDir: string): Promise<StateGeometry[]> {
    const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    try {
        await page.navigate(buildViewUrl(port));
        const captured: StateGeometry[] = [];
        for (const state of VISUAL_STATES) {
            process.stdout.write(`  driving ${state.name}\n`);
            await state.drive(page);
            captured.push(await captureState(page, outDir, state.name));
        }
        return captured;
    } finally {
        await page.close();
    }
}

// Group a run's violations by rule so the report is a handful of lines rather than one per bubble.
export function summarize(violations: Violation[]): string[] {
    const counts = new Map<string, number>();
    for (const violation of violations) {
        const key = `${violation.state} · ${violation.rule}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].map(([key, count]) => `  FAIL ${key} × ${count}`);
}

// The first few examples of each rule — enough to fix from, without printing 800 rectangles.
export function listExamples(violations: Violation[], perRule: number): string[] {
    const shown = new Map<string, number>();
    const lines: string[] = [];
    for (const violation of violations) {
        const seen = shown.get(violation.rule) ?? 0;
        if (seen >= perRule) {
            continue;
        }
        shown.set(violation.rule, seen + 1);
        lines.push(`    ${violation.rule}: ${violation.detail}`);
    }
    return lines;
}

async function main(): Promise<number> {
    const label = process.argv[2] ?? "run";
    const outDir = join(JFRED_ROOT, "scripts", "visual", "out", label);
    mkdirSync(outDir, { recursive: true });

    buildWebapp();
    killPort(CONVENTIONAL_PORT);
    const port = await findFreePort();
    killPort(port);
    const server = await startViewer(port);
    try {
        const captured = await captureAllStates(port, outDir);
        const violations = captured.flatMap(checkStateGeometry);
        writeFileSync(join(outDir, "violations.json"), JSON.stringify(violations, null, 2));
        const bubbles = captured[0]?.fileboxes.length ?? 0;
        process.stdout.write(`\n${label}: ${captured.length} states, ${bubbles} bubbles, ${violations.length} violations\n`);
        for (const line of [...summarize(violations), ...listExamples(violations, 3)]) {
            process.stdout.write(`${line}\n`);
        }
        process.stdout.write(`artifacts: ${outDir}\n`);
        return violations.length === 0 ? 0 : 1;
    } finally {
        server.kill("SIGKILL");
        await pause(200);
        killPort(port);
    }
}

// Only when invoked as the script, so the test can import the pure helpers above without launching
// a browser.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
}
