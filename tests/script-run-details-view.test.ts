// View-model tests for script-run wiring: scriptRuns join tool-call nodes and resolve to revisions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveToolCallNodes } from "../webapp/views/timeline-node-derive.ts";
import { buildScriptRunDetailsViewModel } from "../webapp/views/details-script-run-model.ts";
import type { WireFileHistory, WireTimelineDocument } from "../webapp/views/timeline-wire-types.ts";

function buildWireDocument(overrides: Partial<WireTimelineDocument>): WireTimelineDocument {
    return {
        filesTouched: [],
        rewoundFilesTouched: [],
        messages: [],
        steps: [],
        commitMarkers: [],
        ...overrides,
    };
}

function buildSingleHistoryDocument(target: string, revisions: WireFileHistory["revisions"]): WireTimelineDocument {
    const history: WireFileHistory = { target, revisions };
    return buildWireDocument({ filesTouched: [history] });
}

test("test_deriveToolCallNodes_stamps_scriptRun_on_modifying_runs", () => {
    // Scenario: only a run that modified files rides its tool-call row; read-only runs stamp nothing.
    const document = buildWireDocument({
        toolCalls: [
            { toolName: "Bash", summary: "python3 rename.py", timestamp: "2026-07-01T10:00:00Z", uuid: "u1", toolUseId: "toolu_1" },
            { toolName: "Bash", summary: "ls", timestamp: "2026-07-01T10:01:00Z", uuid: "u2", toolUseId: "toolu_2" },
        ],
        scriptRuns: [
            { toolUseId: "toolu_1", timestamp: "2026-07-01T10:00:00Z", code: "import re", changedPaths: ["/p/a.py"] },
            { toolUseId: "toolu_2", timestamp: "2026-07-01T10:01:00Z", code: "ls", changedPaths: [] },
        ],
    });
    const nodes = deriveToolCallNodes(document);
    assert.deepEqual(nodes[0]!.scriptRun, document.scriptRuns![0]);
    assert.equal(nodes[1]!.scriptRun, undefined);
    const withoutRuns = deriveToolCallNodes(buildWireDocument({ toolCalls: document.toolCalls }));
    assert.equal(withoutRuns[0]!.scriptRun, undefined);
});

test("test_buildScriptRunDetailsViewModel_resolves_files_to_revisions", () => {
    // Scenario: a scriptRun changeId resolves to its 1-based revision; an untracked path resolves to nothing.
    const revisions = [
        { kind: "write", changeId: "toolu_0", timestamp: "2026-07-01T09:00:00Z" },
        { kind: "script-execution", changeId: "scriptRun:toolu_1:/p/a.py", timestamp: "2026-07-01T10:00:00Z" },
    ];
    const document = buildSingleHistoryDocument("/p/a.py", revisions);
    const scriptRun = { toolUseId: "toolu_1", timestamp: "2026-07-01T10:00:00Z", code: "import re", changedPaths: ["/p/a.py", "/p/missing.py"] };
    const viewModel = buildScriptRunDetailsViewModel(scriptRun, document);
    assert.equal(viewModel.code, "import re");
    assert.deepEqual(viewModel.files, [
        { path: "/p/a.py", target: "/p/a.py", revisionNumber: 2 },
        { path: "/p/missing.py", target: undefined, revisionNumber: undefined },
    ]);
});

test("test_buildScriptRunDetailsViewModel_falls_back_to_first_revision_at_or_after_run", () => {
    // Scenario: without a scriptRun changeId, a file resolves to the first revision at or after the run.
    const revisions = [
        { kind: "write", changeId: "toolu_0", timestamp: "2026-07-01T09:00:00Z" },
        { kind: "edit", changeId: "a.py@v2", timestamp: "2026-07-01T10:05:00Z" },
        { kind: "edit", changeId: "a.py@v3", timestamp: "2026-07-01T11:00:00Z" },
    ];
    const document = buildSingleHistoryDocument("/p/a.py", revisions);
    const runBetween = { toolUseId: "toolu_9", timestamp: "2026-07-01T10:00:00Z", code: "x", changedPaths: ["/p/a.py"] };
    assert.equal(buildScriptRunDetailsViewModel(runBetween, document).files[0]!.revisionNumber, 2);
    const runAfterAll = { ...runBetween, timestamp: "2026-07-01T12:00:00Z" };
    assert.equal(buildScriptRunDetailsViewModel(runAfterAll, document).files[0]!.revisionNumber, 3);
});
