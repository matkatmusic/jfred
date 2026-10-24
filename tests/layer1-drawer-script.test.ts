// Task 356: a shared script-run drawer, keyed by toolUseId rather than (node, path).

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getRequiredElementById } from "../webapp/app-dom.ts";
import { rememberDrawnView, rememberNavTargets } from "../webapp/layer1-diff-wash.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import type { WireLayer1View, WireScriptRun } from "../webapp/layer1-wire.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import {
    DISK_FILE_CONTENT, LANE_T0, LANE_T2, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches,
} from "./layer1-drawer-test-helpers.ts";

const T0 = LANE_T0;
const T2 = LANE_T2;
const SCRIPT_TOOL_USE_ID = "toolu_ren_1";
const SCRIPT_RUN: WireScriptRun = {
    instant: T0, axisPx: 0, toolUseId: SCRIPT_TOOL_USE_ID,
    executorKind: "python", language: "python", line: 83, code: 'open("rename_inv.py").read()', label: "rename_inv.py",
    sessionId: "fixture-0f3c9a7e", sessionFile: "/fixture/demo/projects/0f3c9a7e.jsonl",
};

function armScriptRunView(): void {
    rememberDrawnView({
        pairs: [
            { path: "src/a.ts", commits: [], onDisk: { instant: T2, axisPx: 40 }, scriptRuns: [SCRIPT_RUN] },
            { path: "src/b.ts", commits: [], onDisk: { instant: T2, axisPx: 40 }, scriptRuns: [SCRIPT_RUN] },
        ],
        gitOrphans: [], diskOrphans: [],
        ruler: [{ instant: T0, axisPx: 0, eventCount: 1 }, { instant: T2, axisPx: 40, eventCount: 1 }],
    } as WireLayer1View);
    rememberNavTargets([]);
}

function buildScriptRunStage(): { nodeA: HTMLElement; nodeB: HTMLElement; connector: HTMLElement } {
    const nodeA = el("i", { class: "node n-script", "data-tool-use-id": SCRIPT_TOOL_USE_ID });
    const nodeB = el("i", { class: "node n-script", "data-tool-use-id": SCRIPT_TOOL_USE_ID });
    const connector = el("div", { class: "script-connector", "data-tool-use-id": SCRIPT_TOOL_USE_ID });
    getRequiredElementById("stage").replaceChildren(
        el("div", { class: "filebox" }, [
            el("div", { class: "fname", text: "a.ts", "data-path": "src/a.ts" }),
            el("div", { class: "lane" }, [nodeA]),
        ]),
        connector,
        el("div", { class: "filebox" }, [
            el("div", { class: "fname", text: "b.ts", "data-path": "src/b.ts" }),
            el("div", { class: "lane" }, [nodeB]),
        ]),
    );
    return { nodeA, nodeB, connector };
}

test("task 356: clicking a script-run node opens the shared drawer with the resolved body", async () => {
    setupLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const { nodeA } = buildScriptRunStage();
    armScriptRunView();
    wireNodeDrawer();

    nodeA.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    assert.ok(getRequiredElementById("drawer").classList.contains("open"));
    const header = getRequiredElementById("dpath");
    assert.equal(header.firstChild?.textContent, "rename_inv.py");
    const badges = [...header.querySelectorAll(".run-status")].map((badge) => `${badge.textContent}=${badge.getAttribute("title")}`);
    assert.deepEqual(badges, ["❌=not verified", "✅=located", "❌=not replayed"]);
    const titleText = header.textContent ?? "";
    for (const expected of ["Verified: ❌", "Located: ✅", "Replayed: ❌"]) {
        assert.ok(titleText.includes(expected), titleText);
    }
    assert.ok(!/[📍⏸🚫]/u.test(titleText), titleText);
    const metaText = getRequiredElementById("dmeta").textContent ?? "";
    assert.ok(metaText.includes("src/a.ts") && metaText.includes("src/b.ts"), metaText);
    const body = getRequiredElementById("dbody");
    assert.equal(body.querySelector(".scriptbody pre")?.textContent, SCRIPT_RUN.code);
    assert.equal(body.querySelector(".scriptbody .sbhead b")?.textContent, "rename_inv.py");
    assert.equal(body.querySelector(".scriptbody .prov")?.textContent,
        `resolved body · ${SCRIPT_RUN.sessionFile} · line 83 · ${SCRIPT_TOOL_USE_ID} · ${SCRIPT_RUN.instant}`);
    const metaRows = [...body.querySelectorAll("dl.script-meta dt")].map((term) => `${term.textContent}=${term.nextElementSibling?.textContent}`);
    assert.deepEqual(metaRows, [
        "kind=script run (layer 4)", "executor=python run", `instant=${SCRIPT_RUN.instant}`,
        `session=${SCRIPT_RUN.sessionFile}`, "line=83", `tool use id=${SCRIPT_TOOL_USE_ID}`,
    ]);
    // One diff pane per affected path (src/a.ts and src/b.ts both carry this toolUseId).
    assert.equal(getRequiredElementById("dbody").querySelectorAll("details.dfile").length, 2);
});

test("task 356: clicking the shared connector opens the SAME drawer as clicking a node", async () => {
    setupLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const { connector } = buildScriptRunStage();
    armScriptRunView();
    wireNodeDrawer();

    connector.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    assert.equal(getRequiredElementById("dpath").firstChild?.textContent, "rename_inv.py");
});

test("task 356: an unlabeled script run (no static filename) still opens, with a generated header", async () => {
    setupLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const unlabeled: WireScriptRun = { ...SCRIPT_RUN, toolUseId: "toolu_inline", label: undefined };
    rememberDrawnView({
        pairs: [{ path: "src/a.ts", commits: [], onDisk: { instant: T2, axisPx: 40 }, scriptRuns: [unlabeled] }],
        gitOrphans: [], diskOrphans: [],
        ruler: [{ instant: T2, axisPx: 40, eventCount: 1 }],
    } as WireLayer1View);
    rememberNavTargets([]);
    const node = el("i", { class: "node n-script", "data-tool-use-id": "toolu_inline" });
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "a.ts", "data-path": "src/a.ts" }),
        el("div", { class: "lane" }, [node]),
    ]));
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    assert.equal(getRequiredElementById("dpath").firstChild?.textContent, "python run");
});

// Opens the drawer on one unlabeled run of the given language and returns the drawer body.
async function openUnlabeledRun(language: WireScriptRun["language"], code: string): Promise<HTMLElement> {
    setupLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const run: WireScriptRun = { ...SCRIPT_RUN, toolUseId: "toolu_lang", label: undefined, language, code };
    rememberDrawnView({
        pairs: [{ path: "src/a.ts", commits: [], onDisk: { instant: T2, axisPx: 40 }, scriptRuns: [run] }],
        gitOrphans: [], diskOrphans: [],
        ruler: [{ instant: T2, axisPx: 40, eventCount: 1 }],
    } as WireLayer1View);
    rememberNavTargets([]);
    const node = el("i", { class: "node n-script", "data-tool-use-id": "toolu_lang" });
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "a.ts", "data-path": "src/a.ts" }),
        el("div", { class: "lane" }, [node]),
    ]));
    wireNodeDrawer();
    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    return getRequiredElementById("dbody");
}

test("an unlabeled run's title reads its language: shell run, typescript run, and $ for the Bash tool", async () => {
    for (const [language, title] of [["shell", "shell run"], ["typescript", "typescript run"], ["bash", "$"]] as const) {
        const body = await openUnlabeledRun(language, "x");
        assert.equal(getRequiredElementById("dpath").firstChild?.textContent, title);
        assert.equal(body.querySelector(".scriptbody .sbhead b")?.textContent, title);
        const executorRow = [...body.querySelectorAll("dl.script-meta dt")].find((term) => term.textContent === "executor");
        assert.equal(executorRow?.nextElementSibling?.textContent, title);
    }
});

test("the script body is highlighted for python, shell, javascript and typescript, and plain for ruby", async () => {
    const highlighted: string[] = [];
    Object.assign(globalThis, {
        hljs: {
            getLanguage: (name: string) => name === "ruby" ? undefined : {},
            highlight: (code: string, options: { language: string }) => {
                // The diff panes highlight the file's own text too; only the script body's call is recorded.
                if (code === "code") {
                    highlighted.push(options.language);
                }
                return { value: `<span class="hljs-keyword">${code}</span>` };
            },
        },
    });
    try {
        for (const [language, hljsLanguage] of [["python", "python"], ["shell", "bash"], ["bash", "bash"], ["javascript", "javascript"], ["typescript", "typescript"]] as const) {
            const body = await openUnlabeledRun(language, "code");
            assert.ok(body.querySelector(".scriptbody pre .hljs-keyword"), language);
            assert.equal(highlighted.at(-1), hljsLanguage);
        }
        const plain = await openUnlabeledRun("ruby", "code");
        assert.equal(plain.querySelector(".scriptbody pre .hljs-keyword"), null);
        assert.equal(plain.querySelector(".scriptbody pre")?.textContent, "code");
    } finally {
        Reflect.deleteProperty(globalThis, "hljs");
    }
});
