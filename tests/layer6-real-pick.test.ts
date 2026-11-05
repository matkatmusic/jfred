// Tests for findRealScript in layer6-real-pick.ts, with fetch answered by canned server replies.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findRealScript } from "../scripts/visual/layer6-real-pick.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import type { WireScriptRunsView } from "../webapp/layer1-wire-script-runs.ts";

type ChangedFile = { path: string; confidence: WireConfidence };

const target = { origin: "http://127.0.0.1:1", query: "dir=x" };
const buildRun = (toolUseId: string, hour: number) => ({
    toolUseId, executorKind: "python", language: "python", instant: `2026-07-01T${hour}:00:00.000Z`,
    code: "print(1)", sessionId: "s1", sessionFile: "s1.jsonl", line: hour,
});
const view = { pairs: [{ path: "src/a.py", scriptRuns: [buildRun("toolu_early", 10), buildRun("toolu_late", 11)] }] } as WireScriptRunsView;
const verified = (path: string): ChangedFile => ({ path, confidence: WireConfidence.verified });

function buildResultLine(toolUseId: string, files: ChangedFile[]): string {
    return JSON.stringify({ kind: "script-result", toolUseId, outcome: WireRunOutcome.replayed, files, stdout: "", stderr: "", timedOut: false, isOutputSaved: true });
}

async function pickWith(filesByRun: Record<string, ChangedFile[]>, pairPaths: string[], posts: string[] = []) {
    const realFetch = globalThis.fetch;
    const log = console.log;
    console.log = () => {};
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes("/api/layer1-view"))
            return new Response(JSON.stringify({ pairs: pairPaths.map((path) => ({ path })) }));
        const { toolUseId } = JSON.parse(String(init?.body)) as { toolUseId: string };
        if (url.includes("/api/layer1-script-needs"))
            return new Response(JSON.stringify({ toolUseId, needs: [] }));
        posts.push(toolUseId);
        return new Response(`${buildResultLine(toolUseId, filesByRun[toolUseId] ?? [])}\n`);
    };
    try {
        return await findRealScript(target, view);
    } finally {
        console.log = log;
        globalThis.fetch = realFetch;
    }
}

test("test_findRealScript_passes_over_a_run_whose_only_changed_file_is_outside_the_pairs", async () => {
    const posts: string[] = [];
    const picked = await pickWith({ toolu_early: [verified("docs/orphan.md")], toolu_late: [verified("src/a.py")] }, ["src/a.py"], posts);
    assert.deepEqual(posts, ["toolu_early", "toolu_late"]);
    assert.notEqual(picked.toolUseId, "toolu_early");
});

test("test_findRealScript_picks_a_later_run_with_a_changed_file_in_the_pairs", async () => {
    const picked = await pickWith({ toolu_early: [verified("docs/orphan.md")], toolu_late: [verified("src/a.py")] }, ["src/a.py"]);
    assert.equal(picked.toolUseId, "toolu_late");
    assert.equal(picked.sessionFile, "s1.jsonl");
});

test("test_findRealScript_returns_only_the_changed_paths_that_are_pairs", async () => {
    const files = [verified("src/a.py"), verified("docs/orphan.md"), verified("src/b.py")];
    const picked = await pickWith({ toolu_early: files }, ["src/a.py", "src/b.py"]);
    assert.deepEqual(picked.changedPaths, ["src/a.py", "src/b.py"]);
});

test("test_findRealScript_throws_the_named_reason_with_the_count_when_no_run_qualifies", async () => {
    const outsideOnly = { toolu_early: [verified("docs/orphan.md")], toolu_late: [verified("docs/other.md")] };
    await assert.rejects(pickWith(outsideOnly, ["src/a.py"]), (error: Error) => {
        assert.match(error.message, /changed file that is a pair/);
        assert.match(error.message, /2 replayed runs changed files only outside the pairs/);
        return true;
    });
});
