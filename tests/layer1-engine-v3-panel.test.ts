// The engineV3 bar: five buttons, the marked node, the readout and the on/off rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { renderEngineV3LineAtTicks } from "../webapp/layer1-components/engine-v3/layer1-engine-v3-line.ts";
import { loadEngineV3Steps } from "../webapp/layer1-components/engine-v3/layer1-engine-v3-panel.ts";
import { EngineV3StepKind, type WireEngineV3Step } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const STEPS: WireEngineV3Step[] = [
    { nodeId: "aaaa1111", nodeTime: "2026-06-01T09:00:00Z", kind: EngineV3StepKind.commit, filesChanged: ["src/index.ts", "README.md"], sentence: "The first commit in the repo overwrites two files." },
    { nodeId: "node-1", nodeTime: "2026-06-01T09:01:00Z", kind: EngineV3StepKind.noFileChange, filesChanged: [], sentence: "You ask a question." },
    { nodeId: "node-2", nodeTime: "2026-06-01T09:02:00Z", kind: EngineV3StepKind.edit, filesChanged: ["src/util.ts", "src/index.ts"], sentence: "Claude edits two files." },
    { nodeId: "bbbb2222", nodeTime: "2026-06-01T09:03:00Z", kind: EngineV3StepKind.commit, filesChanged: ["src/util.ts"], sentence: "A commit overwrites one file." },
    { nodeId: "node-4", nodeTime: "2026-06-01T09:04:00Z", kind: EngineV3StepKind.script, filesChanged: ["src/index.ts"], sentence: "A script runs." },
];
const BUTTON_IDS = {
    "Start over": "engine-v3-start-over", "Jump to previous commit": "engine-v3-previous-commit", "Step backwards": "engine-v3-step-backwards",
    "Step forward": "engine-v3-step-forward", "Jump to next commit": "engine-v3-next-commit",
} as const;

function installStepsFetch(): void {
    const answer = async (): Promise<Response> => ({ ok: true, status: 200, json: async () => ({ steps: STEPS }) }) as unknown as Response;
    Object.assign(globalThis, { fetch: answer });
}

function drawNodes(): void {
    const stage = document.createElement("div");
    for (const step of STEPS) {
        const isCommit = step.kind === EngineV3StepKind.commit;
        const node = document.createElement("i");
        node.className = isCommit ? "node n-commit" : "anode";
        node.setAttribute(isCommit ? "title" : "data-record-id", step.nodeId);
        stage.append(node);
        if (isCommit) {
            const secondLaneNode = node.cloneNode() as HTMLElement;
            stage.append(secondLaneNode);
        }
    }
    getRequiredElementById("stage").replaceChildren(stage);
}

async function openPanel(): Promise<void> {
    initLayer1Dom();
    installStepsFetch();
    drawNodes();
    await loadEngineV3Steps({ annotations: [] });
}

function clickButton(label: keyof typeof BUTTON_IDS): void {
    getRequiredElementById(BUTTON_IDS[label]).click();
}

function isButtonOff(label: keyof typeof BUTTON_IDS): boolean {
    return (getRequiredElementById(BUTTON_IDS[label]) as HTMLButtonElement).disabled;
}

function listCurrentNodes(): string[] {
    const ids: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>(".current-node")) {
        ids.push(node.getAttribute("title") ?? node.dataset["recordId"]!);
    }
    return ids;
}

const LINE_TICKS = [
    { instant: "2026-06-01T09:00:00Z", axisPx: 100, eventCount: 1 },
    { instant: "2026-06-01T09:04:00Z", axisPx: 900, eventCount: 1 },
];

// Draws the line, then makes it sit off screen and counts the scrolls the page asks for.
function watchLineScrolls(): { scrolls: unknown[] } {
    renderEngineV3LineAtTicks(LINE_TICKS);
    const scrolls: unknown[] = [];
    getRequiredElementById("timelines").getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
    getRequiredElementById("engine-v3-line").getBoundingClientRect = () => ({ top: 2000, bottom: 2002 }) as DOMRect;
    getRequiredElementById("engine-v3-line").scrollIntoView = (options?: unknown) => scrolls.push(options);
    return { scrolls };
}

test("test_every_button_click_scrolls_the_line_into_view_when_it_is_off_screen", async () => {
    // Steps: click each of the five buttons that is on, expect one scroll per click.
    await openPanel();
    const { scrolls } = watchLineScrolls();
    clickButton("Step forward");
    clickButton("Step backwards");
    clickButton("Jump to next commit");
    clickButton("Jump to previous commit");
    clickButton("Step forward");
    clickButton("Start over");
    assert.equal(scrolls.length, 6);
});

test("test_a_node_click_scrolls_the_line_into_view_when_it_is_off_screen", async () => {
    await openPanel();
    const { scrolls } = watchLineScrolls();
    document.querySelector<HTMLElement>('i.anode[data-record-id="node-4"]')!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(scrolls.length, 1);
});

test("test_the_bar_stays_hidden_when_the_view_has_no_session_column_records", async () => {
    initLayer1Dom();
    await loadEngineV3Steps({});
    assert.equal(getRequiredElementById("engine-v3-bar").hidden, true);
});

test("test_the_bar_has_the_five_buttons_in_order", async () => {
    await openPanel();
    const labels: string[] = [];
    for (const button of document.querySelectorAll("#engine-v3-bar button")) {
        labels.push(button.textContent!.trim());
    }
    assert.deepEqual(labels, Object.keys(BUTTON_IDS));
});

test("test_the_first_commit_is_marked_at_load_and_read_out", async () => {
    // Steps: open the bar, expect both nodes of the first commit marked, no Session node, and its sentence.
    await openPanel();
    assert.deepEqual(listCurrentNodes(), ["aaaa1111", "aaaa1111"]);
    assert.equal(getRequiredElementById("engine-v3-sentence").textContent, "The first commit in the repo overwrites two files.");
    assert.equal(getRequiredElementById("engine-v3-files").textContent, "Files changed: src/index.ts, README.md");
    assert.equal(getRequiredElementById("engine-v3-bar").dataset["markerIndex"], "0");
});

test("test_step_forward_marks_the_next_session_node_and_no_commit_node", async () => {
    await openPanel();
    clickButton("Step forward");
    assert.deepEqual(listCurrentNodes(), ["node-1"]);
    assert.equal(getRequiredElementById("engine-v3-files").textContent, "No files changed.");
});

test("test_step_backwards_marks_the_step_before", async () => {
    await openPanel();
    clickButton("Step forward");
    clickButton("Step forward");
    clickButton("Step backwards");
    assert.deepEqual(listCurrentNodes(), ["node-1"]);
});

test("test_jump_to_next_commit_marks_the_nodes_of_that_commit", async () => {
    await openPanel();
    clickButton("Jump to next commit");
    assert.deepEqual(listCurrentNodes(), ["bbbb2222", "bbbb2222"]);
    assert.equal(getRequiredElementById("engine-v3-bar").dataset["markerIndex"], "3");
});

test("test_jump_to_previous_commit_marks_the_nearest_earlier_commit", async () => {
    await openPanel();
    clickButton("Jump to next commit");
    clickButton("Step forward");
    clickButton("Jump to previous commit");
    assert.deepEqual(listCurrentNodes(), ["bbbb2222", "bbbb2222"]);
});

test("test_start_over_marks_the_first_commit_again", async () => {
    await openPanel();
    clickButton("Step forward");
    clickButton("Start over");
    assert.deepEqual(listCurrentNodes(), ["aaaa1111", "aaaa1111"]);
    assert.equal(getRequiredElementById("engine-v3-bar").dataset["markerIndex"], "0");
});

test("test_a_click_on_a_session_column_node_marks_that_node", async () => {
    await openPanel();
    document.querySelector<HTMLElement>('i.anode[data-record-id="node-4"]')!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.deepEqual(listCurrentNodes(), ["node-4"]);
    assert.equal(getRequiredElementById("engine-v3-sentence").textContent, "A script runs.");
});

test("test_start_over_is_off_on_the_first_commit_and_on_after_a_step", async () => {
    await openPanel();
    assert.equal(isButtonOff("Start over"), true);
    clickButton("Step forward");
    assert.equal(isButtonOff("Start over"), false);
});

test("test_step_backwards_is_off_on_the_first_commit_and_on_after_a_step", async () => {
    await openPanel();
    assert.equal(isButtonOff("Step backwards"), true);
    clickButton("Step forward");
    assert.equal(isButtonOff("Step backwards"), false);
});

test("test_jump_to_previous_commit_is_off_on_the_first_commit_and_on_after_a_step", async () => {
    await openPanel();
    assert.equal(isButtonOff("Jump to previous commit"), true);
    clickButton("Step forward");
    assert.equal(isButtonOff("Jump to previous commit"), false);
});

test("test_step_forward_is_off_on_the_last_step_only", async () => {
    // Steps: jump to the last commit, expect Step forward on, step to the last step, expect it off.
    await openPanel();
    clickButton("Jump to next commit");
    assert.equal(isButtonOff("Step forward"), false);
    clickButton("Step forward");
    assert.equal(isButtonOff("Step forward"), true);
});

test("test_jump_to_next_commit_is_off_when_no_commit_comes_after_the_marker", async () => {
    await openPanel();
    assert.equal(isButtonOff("Jump to next commit"), false);
    clickButton("Jump to next commit");
    assert.equal(isButtonOff("Jump to next commit"), true);
});
