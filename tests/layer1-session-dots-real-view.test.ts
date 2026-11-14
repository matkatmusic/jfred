// Task 888 steps 9 and 22: a real view built from a temp chat log shows the session button and draws the log's dots.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { buildLayer1View } from "../src/viewer_api_layer1.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { createFixtureDiskFolder, createFixtureRepo } from "./layer1-view-test-helpers.ts";
import { SESSION_ONE, writeSessionTranscript } from "./layer1-snapshot-wire-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";
import { resetSessionDotsPage, SESSION_DOTS_PATHNAME, setPaneSize, setUpSessionDotsPage } from "./layer1-session-dots-test-helpers.ts";
import { getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { writeSourcePaths } = await import("../webapp/layer1-components/top-bars/layer1-source-paths.ts");

const DEBOUNCE_PLUS_SLACK_MS = 300;
const WHOLE_RULER_HEIGHT_PX = 100000;
const SESSION_DOT_INSTANTS_PATHNAME = "/api/layer1-session-dot-instants";

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildRealView(diskDir: string, logFile: Path): WireLayer1View {
    const view = buildLayer1View(new Path(diskDir), new Path(createFixtureRepo()), "HEAD", undefined, undefined, [logFile]);
    return JSON.parse(JSON.stringify(view)) as WireLayer1View;
}

function readDrawnDots(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("#sessionDotLinesComponent .anode")];
}

function collectDatasetValues(nodes: HTMLElement[], key: string): (string | undefined)[] {
    const values: (string | undefined)[] = [];
    for (const node of nodes) {
        values.push(node.dataset[key]);
    }
    return values;
}

test("test_a_real_view_built_from_a_temp_chat_log_shows_the_session_button", async () => {
    // Scenario: the view of a real project has no annotations; with a jsonl path on the page the session button shows.
    // A temp project has a disk folder, a repo and one chat log with one user record.
    const diskDir = createFixtureDiskFolder();
    const treeRoot = createTempDir();
    const logFile = writeSessionTranscript(treeRoot, SESSION_ONE, [
        { type: "user", timestamp: "2026-07-01T11:00:00.000Z", sessionId: SESSION_ONE, message: { role: "user", content: "hello" } },
    ]);
    // The server builds the view and it travels as JSON.
    const view = buildRealView(diskDir, logFile);
    // The real view carries no annotations.
    assert.equal(view.annotations, undefined);
    setUpSessionDotsPage();
    try {
        // The page knows the folder of the chat log, and the dots route answers with nothing.
        writeSourcePaths(SourceKind.jsonl, [dirname(logFile.toString())]);
        installFetchRoutes({ [SESSION_DOTS_PATHNAME]: { annotations: [], sessionSpans: [] } });
        // The page draws the view.
        await renderLayer1View(view);
        // The user sees the session button.
        assert.equal((getRequiredElementById("session-toggle") as HTMLButtonElement).hidden, false);
    }
    finally {
        resetSessionDotsPage();
    }
});

test("test_a_real_view_draws_the_dots_of_its_chat_log_when_the_session_button_is_on", async () => {
    // Scenario: real log to real dots: server index, route answer, page track.
    const { encodeProjectFolderName } = await import("../src/reconstruction_repo_discovery.ts");
    const { buildLayer1SessionDots } = await import("../src/viewer_api_layer1_session_dots.ts");
    const { buildLayer1SessionDotInstants } = await import("../src/viewer_api_layer1_session_dot_instants.ts");
    // A project log holds a user record, a tool_use, its tool_result, and a record without a timestamp.
    const diskDir = createFixtureDiskFolder();
    const treeRoot = createTempDir();
    const logFile = writeSessionTranscript(treeRoot, SESSION_ONE, [
        { type: "user", timestamp: "2026-07-01T11:00:00.000Z", sessionId: SESSION_ONE, message: { role: "user", content: "hello" } },
        { type: "assistant", timestamp: "2026-07-01T11:30:00.000Z", sessionId: SESSION_ONE, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_pair_1", name: "Read", input: {} }] } },
        { type: "user", timestamp: "2026-07-01T11:31:00.000Z", sessionId: SESSION_ONE, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_pair_1", content: "done" }] } },
        { type: "user", sessionId: SESSION_ONE, message: { role: "user", content: "no stamp" } },
    ], encodeProjectFolderName(diskDir));
    const view = buildRealView(diskDir, logFile);
    setUpSessionDotsPage();
    try {
        // The page knows the log folder and the project folder, and the whole ruler is on screen.
        writeSourcePaths(SourceKind.jsonl, [dirname(logFile.toString())]);
        getInputById("dir").value = diskDir;
        setPaneSize(WHOLE_RULER_HEIGHT_PX, 0);
        // The dots route answers from the real server function, for the range the page asks.
        function answerFromTheRealServer(url: unknown): Promise<Response> {
            const { pathname, searchParams } = new URL(String(url), "http://localhost:7343");
            const isDotsRoute = pathname === SESSION_DOTS_PATHNAME;
            const isInstantsRoute = pathname === SESSION_DOT_INSTANTS_PATHNAME;
            const isKnownRoute = isDotsRoute || isInstantsRoute;
            const status = isKnownRoute ? 200 : 404;
            const range = { from: new Date(searchParams.get("from") ?? ""), to: new Date(searchParams.get("to") ?? "") };
            const dotsAnswer = isDotsRoute ? JSON.parse(JSON.stringify(buildLayer1SessionDots(new Path(diskDir), [logFile], range))) : {};
            const answer = isInstantsRoute ? JSON.parse(JSON.stringify(buildLayer1SessionDotInstants(new Path(diskDir), [logFile]))) : dotsAnswer;
            return Promise.resolve({ ok: isKnownRoute, status, json: async () => answer, text: async () => "not stubbed" } as unknown as Response);
        }
        Object.assign(globalThis, { fetch: answerFromTheRealServer });
        await renderLayer1View(view);
        // The user turns the session button on and waits for the answer.
        getRequiredElementById("session-toggle").click();
        await waitMilliseconds(DEBOUNCE_PLUS_SLACK_MS);
        // The track shows four dots: user, tool_use, tool_result, user.
        const dots = readDrawnDots();
        assert.deepEqual(collectDatasetValues(dots, "recordKind"), ["user", "tool_use", "tool_result", "user"]);
        // Only the fourth dot has no timestamp of its own.
        assert.deepEqual(dots.map((dot) => dot.classList.contains("is-stampless")), [false, false, false, true]);
        // The tool_use and the tool_result share one pair id.
        assert.ok(dots[1]!.dataset["pairId"]);
        assert.equal(dots[1]!.dataset["pairId"], dots[2]!.dataset["pairId"]);
        // Every dot names the log and its own line.
        assert.deepEqual(collectDatasetValues(dots, "sessionFile"), [logFile.toString(), logFile.toString(), logFile.toString(), logFile.toString()]);
        assert.deepEqual(collectDatasetValues(dots, "line"), ["1", "2", "3", "4"]);
    }
    finally {
        resetSessionDotsPage();
    }
});
