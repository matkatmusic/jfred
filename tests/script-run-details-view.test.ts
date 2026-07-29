// View-model tests for the script-run timeline/details wiring (task 67): the wire document's scriptRuns join onto tool-call nodes, and the Details pane's script-run view model resolves each changed file to the revision whose diff shows the run's before/after. Fixtures are wire-shaped literals (what the browser sees after fetch + JSON.parse).

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveToolCallNodes } from "../webapp/views/timeline-node-derive.ts";
import { buildScriptRunDetailsViewModel } from "../webapp/views/details-script-run-model.ts";
import type { WireFileHistory, WireTimelineDocument } from "../webapp/views/timeline-types.ts";

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
    // Scenario: only a run the sandbox proved modified files rides its tool-call row — a read-only run (empty changedPaths) and a document without scriptRuns stamp nothing.
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
    // Scenario: a changed path with a scriptRun:<toolUseId>: revision resolves to that revision (1-based); a path no history tracks resolves to nothing and renders as a note.
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
    // Scenario: beacon-evidenced script effects carry no scriptRun: changeId (s25), so the file resolves to the FIRST revision at/after the run instant — the run's own effect — and, when every revision precedes the run, to the LAST (the state the run acted on).
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
