// Tests for validateLayer6 in layer6-checks.ts, using a fake page whose button and popup answers follow the clicks.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateLayer6 } from "../scripts/visual/layer6-checks.ts";
import {
    BUTTON_FACTS, CLICK_CLOSE, CLICK_OPEN_BUTTON, CLOSE_LABEL, COUNT_CONSOLES, COUNT_CONSOLE_BUTTONS, MISMATCH_ID, NEVER_PROVABLE_ID,
    PENDING_ID, POPUP_FACTS, README_NODE_FACTS, type PopupFacts,
} from "../scripts/visual/layer6-probes.ts";

const SCREENSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out");
const SCREENSHOT_FILES = ["mockup-12-layer6-node-states.png", "mockup-13-layer6-popup.png"].map((name) => join(SCREENSHOT_DIR, name));
const TOOL_USE_ID = /data-tool-use-id="([^"]+)"/;
const POPUP_SHAPE = {
    width: 300, height: 200, insideDrawer: false, drawerOpen: true, popupRect: [], stageRect: [], drawerRect: [],
    terminalClasses: [], terminalColours: [], cancelledDecoration: "",
} as unknown as PopupFacts;

interface FakeOptions { buttonNodeIds: string[]; closeLabel: string }

function makeFake(options: FakeOptions) {
    const state = { currentNodeId: "", openedNodeIds: [] as string[], navigations: [] as string[], isPopupHidden: true };
    const countButtons = () => options.buttonNodeIds.includes(state.currentNodeId) ? 1 : 0;
    const answerFor = (expression: string): unknown => {
        if (expression.includes("replaceChildren")) {
            state.currentNodeId = TOOL_USE_ID.exec(expression)?.[1] ?? "";
            state.openedNodeIds.push(state.currentNodeId);
            state.isPopupHidden = true;
            return undefined;
        }
        if (expression === COUNT_CONSOLE_BUTTONS)
            return countButtons();
        if (expression === BUTTON_FACTS)
            return { count: countButtons(), text: "Open run console", insideDrawer: true };
        if (expression === CLOSE_LABEL)
            return options.closeLabel;
        if (expression === CLICK_CLOSE)
            state.isPopupHidden = true;
        if (expression === CLICK_OPEN_BUTTON)
            state.isPopupHidden = false;
        if (expression === COUNT_CONSOLES)
            return 1;
        if (expression === POPUP_FACTS)
            return { ...POPUP_SHAPE, hidden: state.isPopupHidden };
        if (expression === README_NODE_FACTS)
            return [];
        if (expression.includes("performance.getEntriesByType") || expression.includes("#show-row"))
            return [];
        return 0;
    };
    const page: HeadlessPage = {
        evaluate: async <T>(expression: string) => answerFor(expression) as T,
        waitFor: async () => {},
        navigate: async (url: string) => { state.navigations.push(url); },
        screenshot: async () => "",
        close: async () => {},
    };
    return { page, state };
}

async function runLayer6(options: FakeOptions) {
    const savedScreenshots = new Map<string, Buffer>();
    for (const file of SCREENSHOT_FILES) {
        if (existsSync(file))
            savedScreenshots.set(file, readFileSync(file));
    }
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    const fake = makeFake(options);
    try {
        await validateLayer6(fake.page, "http://page.test/");
    } finally {
        console.log = log;
        for (const file of SCREENSHOT_FILES) {
            const saved = savedScreenshots.get(file);
            if (saved === undefined)
                rmSync(file, { force: true });
            else
                writeFileSync(file, saved);
        }
    }
    const newFailures = failures.splice(failuresBefore);
    return { lines, state: fake.state, newFailures };
}

function findLine(lines: string[], text: string): string {
    for (const line of lines) {
        if (line.includes(text))
            return line;
    }
    throw new Error(`no line contains: ${text}`);
}

const NO_BUTTON_PENDING = "L6 the pending node opens the drawer with no Open run console button";
const NO_BUTTON_NEVER = "L6 the never-provable node opens the drawer with no Open run console button";
const MISMATCH_BUTTON = "L6 the mismatch node shows one Open run console button, inside the drawer";
const CLOSE_CHECK = "L6 Close hides the popup and leaves the drawer open";
const REOPEN_CHECK = "L6 Open run console again shows the same single popup";

test("validateLayer6 opens the three drawers in order, reloads twice and passes every own check", async () => {
    const { lines, state, newFailures } = await runLayer6({ buttonNodeIds: [MISMATCH_ID], closeLabel: "Close" });
    assert.deepEqual(state.openedNodeIds, [PENDING_ID, NEVER_PROVABLE_ID, MISMATCH_ID]);
    assert.deepEqual(state.navigations, ["http://page.test/", "http://page.test/"]);
    for (const name of [NO_BUTTON_PENDING, NO_BUTTON_NEVER, MISMATCH_BUTTON, CLOSE_CHECK, REOPEN_CHECK])
        assert.ok(findLine(lines, name).startsWith("PASS"), name);
    assert.ok(!newFailures.includes(CLOSE_CHECK));
});

test("validateLayer6 fails the pending check when the pending node shows a button, and only that one", async () => {
    const { lines, newFailures } = await runLayer6({ buttonNodeIds: [PENDING_ID, MISMATCH_ID], closeLabel: "Close" });
    assert.ok(findLine(lines, NO_BUTTON_PENDING).startsWith("FAIL"));
    assert.ok(findLine(lines, NO_BUTTON_NEVER).startsWith("PASS"));
    assert.ok(newFailures.includes(NO_BUTTON_PENDING));
});

test("validateLayer6 fails the mismatch check without a button and the close check with a wrong label", async () => {
    const { lines, newFailures } = await runLayer6({ buttonNodeIds: [], closeLabel: "Dismiss" });
    assert.ok(findLine(lines, MISMATCH_BUTTON).startsWith("FAIL"));
    assert.ok(findLine(lines, CLOSE_CHECK).startsWith("FAIL"));
    assert.ok(findLine(lines, NO_BUTTON_PENDING).startsWith("PASS"));
    assert.ok(newFailures.includes(MISMATCH_BUTTON) && newFailures.includes(CLOSE_CHECK));
});
