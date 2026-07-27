// A minimal Chrome DevTools Protocol driver for the Layer 1 visual loop: launch headless Chrome,
// open one page, evaluate expressions in it, and capture screenshots.
//
// ponytail: plain Node + the global WebSocket against system Chrome, NOT puppeteer. The recipe was
// already proven for this repo (task 96) and adding a browser-automation dependency to drive five
// clicks is the kind of weight this project has repeatedly refused. Everything Chrome needs lives
// in one throwaway --user-data-dir so a run can never inherit a previous run's state.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_BINARY = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// How long Chrome gets to answer /json/version before the run gives up.
const CHROME_BOOT_TIMEOUT_MS = 15_000;

export function pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// A port the OS just confirmed is free, by binding it and letting go. Racy in theory; in practice
// the only other thing on this machine claiming ports in the next second is the viewer we start.
export function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            probe.close(() => resolve(port));
        });
    });
}

// Poll `url` until it answers, so nothing is driven at a browser or a server that is still booting.
export async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(url);
            return;
        } catch {
            await pause(120);
        }
    }
    throw new Error(`nothing answered ${url} within ${timeoutMs}ms`);
}

// Poll an expression in the page until it is truthy. Standalone rather than a method so the retry
// loop is not a third level of nesting inside openHeadlessPage's returned object.
export async function pollUntilTruthy(
    evaluate: <T>(expression: string) => Promise<T>,
    expression: string,
    timeoutMs: number,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await evaluate<boolean>(`!!(${expression})`)) {
            return;
        }
        await pause(250);
    }
    throw new Error(`page never satisfied: ${expression}`);
}

export interface HeadlessPage {
    // Evaluate a JS expression in the page and return its value. Promises are awaited.
    evaluate: <T>(expression: string) => Promise<T>;
    // Poll `expression` until it is truthy — the only way this driver waits for the app.
    waitFor: (expression: string, timeoutMs: number) => Promise<void>;
    navigate: (url: string) => Promise<void>;
    // A viewport PNG, base64-encoded exactly as Page.captureScreenshot returns it.
    screenshot: () => Promise<string>;
    close: () => Promise<void>;
}

interface PendingCall {
    resolve: (result: Record<string, unknown>) => void;
    reject: (error: Error) => void;
}

// The websocket URL of a fresh about:blank target. PUT, not GET: /json/new refuses GET since M111.
async function openTargetSocketUrl(debugPort: number): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
    const target = await response.json() as { webSocketDebuggerUrl: string };
    return target.webSocketDebuggerUrl;
}

function launchChrome(debugPort: number, profileDir: string, width: number, height: number): ChildProcess {
    return spawn(CHROME_BINARY, [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--hide-scrollbars",
        `--window-size=${width},${height}`,
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        "about:blank",
    ], { stdio: "ignore" });
}

// Launch Chrome, attach to one page, and hand back the four operations the loop drives it with.
// Launch and close happen inside ONE process run: a browser daemon does not survive between Bash
// calls, so a run that leaves Chrome up leaks it.
export async function openHeadlessPage(width: number, height: number): Promise<HeadlessPage> {
    const debugPort = await findFreePort();
    const profileDir = mkdtempSync(join(tmpdir(), "layer1-visual-"));
    const chrome = launchChrome(debugPort, profileDir, width, height);
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, CHROME_BOOT_TIMEOUT_MS);

    const socket = new WebSocket(await openTargetSocketUrl(debugPort));
    const pending = new Map<number, PendingCall>();
    let nextCallId = 0;
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
    socket.addEventListener("message", (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as {
            id?: number; result?: Record<string, unknown>; error?: { message: string };
        };
        const call = message.id === undefined ? undefined : pending.get(message.id);
        if (call === undefined || message.id === undefined) {
            return;
        }
        pending.delete(message.id);
        if (message.error !== undefined) {
            call.reject(new Error(message.error.message));
            return;
        }
        call.resolve(message.result ?? {});
    });

    function send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        const id = ++nextCallId;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }

    await send("Page.enable");
    await send("Runtime.enable");
    // The window-size flag sizes the OS window; this sizes the LAYOUT viewport, which is what every
    // bounding box the assertions read is measured against.
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

    async function evaluate<T>(expression: string): Promise<T> {
        const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        const thrown = result.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
        if (thrown !== undefined) {
            throw new Error(thrown.exception?.description ?? thrown.text ?? "page threw");
        }
        return (result.result as { value: T }).value;
    }

    const waitFor = (expression: string, timeoutMs: number) => pollUntilTruthy(evaluate, expression, timeoutMs);

    return {
        evaluate,
        waitFor,
        async navigate(url: string): Promise<void> {
            await send("Page.navigate", { url });
            await waitFor("document.readyState === 'complete'", 30_000);
        },
        async screenshot(): Promise<string> {
            const shot = await send("Page.captureScreenshot", { format: "png" });
            return shot.data as string;
        },
        async close(): Promise<void> {
            socket.close();
            chrome.kill("SIGKILL");
            // Chrome's helper processes keep writing into the profile for a beat after the parent is
            // killed, so deleting it immediately raced them and threw ENOTEMPTY on the second cold
            // run. Wait for the process to be reaped, then let rm retry over the stragglers.
            await new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
            await pause(300);
            rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        },
    };
}
