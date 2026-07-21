// Script-run Details per-file selection (task 144): the left column lists the run's changed
// files; clicking one shows JUST that file's before/after diff on the right — the rev-card
// list -> selected-diff pattern, replacing the old all-files stack.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWebappDom, flushAsyncWork } from "./webapp-dom-test-helpers.ts";

// One diff response per /api/diff call, watermarked with the requested file so the test can
// assert WHICH file's diff the right pane shows. Served through a hand-rolled fetch (the
// shared stubFetchRoutes helper serves JSON; fetchRevisionDiffBlocks reads text()).
function stubDiffFetchByFile(): void {
    const fetchStub = async (url: unknown): Promise<Response> => {
        const parsed = new URL(String(url), "http://localhost:7343");
        const file = parsed.searchParams.get("file") ?? "unknown";
        const text = `@@ changed @ 2026-01-01 @@\n-old ${file}\n+new ${file}`;
        return { ok: true, status: 200, text: async () => text, json: async () => ({}) } as unknown as Response;
    };
    Object.assign(globalThis, { fetch: fetchStub });
}

const scriptRun = {
    toolUseId: "tu1",
    timestamp: "2026-01-01T00:00:05.000Z",
    code: "import shutil",
    changedPaths: ["/tmp/proj/core_one.py", "/tmp/proj/core_two.py"],
};

// Each changed path resolves through a history whose revision the run itself stamped.
const runDocument = {
    filesTouched: [
        {
            target: "/tmp/proj/core_one.py",
            revisions: [{ kind: "script-execution", changeId: "scriptRun:tu1:/tmp/proj/core_one.py", timestamp: "2026-01-01T00:00:05.000Z" }],
        },
        {
            target: "/tmp/proj/core_two.py",
            revisions: [{ kind: "script-execution", changeId: "scriptRun:tu1:/tmp/proj/core_two.py", timestamp: "2026-01-01T00:00:05.000Z" }],
        },
    ],
    scriptRuns: [scriptRun],
};

// Render the script-run mode against a fresh DOM; returns the mode's inputs for assertions.
async function renderScriptRunPane(): Promise<void> {
    setupWebappDom();
    stubDiffFetchByFile();
    const { renderDetailsScriptRunMode } = await import("../webapp/views/details-script-run.ts");
    const node = {
        kind: "tool-call",
        when: "2026-01-01T00:00:05.000Z",
        sessionId: undefined,
        uuid: "u1",
        toolName: "Bash",
        summary: "ran a script",
        toolUseId: "tu1",
        scriptRun,
    };
    const context = {
        project: "proj",
        document: runDocument,
        nodes: [node],
        openNodeInspector: () => {},
        selectTimelineRow: () => {},
        openRecordForChangeId: () => {},
        fetchRangePatch: async () => "",
    };
    // eslint-style casts through unknown: the test builds only the fields the mode reads.
    await renderDetailsScriptRunMode(node as never, 0, context as never);
    await flushAsyncWork();
}

function collectFileButtons(): HTMLButtonElement[] {
    const left = document.getElementById("details-left")!;
    return [...left.querySelectorAll("button.row-btn")] as HTMLButtonElement[];
}

test("test_script_run_pane_lists_each_changed_file_as_a_button", async () => {
    // Scenario (task 144): the left column lists both changed files by basename, first selected.
    await renderScriptRunPane();
    const buttons = collectFileButtons();
    assert.deepEqual(buttons.map((button) => button.textContent), ["core_one.py", "core_two.py"]);
    // the first file starts selected.
    assert.ok(buttons[0]!.classList.contains("selected"));
});

test("test_script_run_pane_shows_only_the_selected_files_diff", async () => {
    // Scenario (task 144): the right pane holds the FIRST file's diff only — not a stack of all.
    await renderScriptRunPane();
    const body = document.getElementById("details-right-body")!;
    assert.ok(body.textContent!.includes("core_one.py"));
    assert.ok(!body.textContent!.includes("core_two.py"));
});

test("test_clicking_a_file_button_swaps_the_diff_to_that_file", async () => {
    // Scenario (task 144): clicking the second file re-renders the right pane with just its diff.
    await renderScriptRunPane();
    const buttons = collectFileButtons();
    buttons[1]!.click();
    await flushAsyncWork();
    const body = document.getElementById("details-right-body")!;
    assert.ok(body.textContent!.includes("core_two.py"));
    assert.ok(!body.textContent!.includes("core_one.py"));
    // selection followed the click.
    assert.ok(buttons[1]!.classList.contains("selected"));
    assert.ok(!buttons[0]!.classList.contains("selected"));
});
