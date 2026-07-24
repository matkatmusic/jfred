import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
    listTargetedSurvivingHistories,
    reconstructSurvivingFileHistory,
} from "../src/reconstruction_target.ts";
import { reconstructBranches, type FileHistory } from "../src/reconstruction_engine.ts";
import { runCli } from "../src/reconstruction_cli.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { lastPrompt } from "./reconstruction-branch-test-helpers.ts";
import {
    SESSION_A,
    SESSION_B,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

// An assistant record on the parentUuid tree carrying one timestamped tool_use — the shape the
// branch-aware equivalence fixtures need (rec() has no timestamp, buildToolRecord no uuid).
function buildTreeToolRecord(
    uuid: string,
    parent: string | null,
    name: ToolName,
    input: Record<string, unknown>,
    timestamp: string,
): TranscriptRecord {
    return {
        type: RecordType.assistant,
        uuid: new Uuid(uuid),
        parentUuid: parent === null ? null : new Uuid(parent),
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: `toolu_${uuid}`, name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// The all-files path's answer for one target: reconstructBranches' surviving histories narrowed
// by exact final path — the contract the targeted fast path must reproduce byte for byte.
function selectSurvivingHistoryViaAllFiles(records: TranscriptRecord[], target: Path): FileHistory | undefined {
    const surviving = reconstructBranches(records).surviving;
    return surviving.find((history) => history.target.toString() === target.toString());
}

// Two files written on a linear (rewind-free) conversation.
function buildTwoFileRecords(): TranscriptRecord[] {
    return [
        buildTreeToolRecord("A", null, ToolName.Write, { file_path: "/proj/alpha.py", content: "alpha = 1\n" }, "2026-01-01T00:00:01Z"),
        buildTreeToolRecord("B", "A", ToolName.Write, { file_path: "/proj/beta.py", content: "beta = 2\n" }, "2026-01-01T00:00:02Z"),
        lastPrompt("B"),
    ];
}

// A rewound branch that wrote gamma.py, then a surviving branch that rewrote alpha.py.
function buildRewoundRecords(): TranscriptRecord[] {
    return [
        buildTreeToolRecord("A", null, ToolName.Write, { file_path: "/proj/alpha.py", content: "alpha = 1\n" }, "2026-01-01T00:00:01Z"),
        buildTreeToolRecord("C", "A", ToolName.Write, { file_path: "/proj/gamma.py", content: "gamma = 3\n" }, "2026-01-01T00:00:02Z"),
        lastPrompt("C"),
        buildTreeToolRecord("D", "A", ToolName.Write, { file_path: "/proj/alpha.py", content: "alpha = 2\n" }, "2026-01-01T00:00:03Z"),
        lastPrompt("D"),
    ];
}

test("test_targeted_history_matches_allfiles_for_simple_write", () => {
    // Scenario: on a linear conversation the fast path returns the exact history the
    // all-branch reconstruction exposes for the same final path.
    const records = buildTwoFileRecords();
    const target = new Path("/proj/alpha.py");
    // reconstruct via both paths and deep-compare the parsed structures.
    const viaAllFiles = selectSurvivingHistoryViaAllFiles(records, target);
    const viaFastPath = reconstructSurvivingFileHistory(records, target);
    assert.ok(viaAllFiles !== undefined);
    assert.deepStrictEqual(viaFastPath, viaAllFiles);
});

test("test_targeted_history_matches_allfiles_with_rewound_branch", () => {
    // Scenario: with a rewound branch present, the fast path still equals the all-branch
    // surviving answer (the rewound gamma.py write must not leak into alpha's history).
    const records = buildRewoundRecords();
    const target = new Path("/proj/alpha.py");
    const viaAllFiles = selectSurvivingHistoryViaAllFiles(records, target);
    const viaFastPath = reconstructSurvivingFileHistory(records, target);
    assert.ok(viaAllFiles !== undefined);
    assert.deepStrictEqual(viaFastPath, viaAllFiles);
});

test("test_targeted_history_for_absent_target_is_undefined", () => {
    // Scenario: a path no evidence touches yields undefined, matching the all-files
    // path's empty filter result.
    const records = buildTwoFileRecords();
    const target = new Path("/proj/missing.py");
    assert.equal(selectSurvivingHistoryViaAllFiles(records, target), undefined);
    assert.equal(reconstructSurvivingFileHistory(records, target), undefined);
});

test("test_targeted_history_for_old_rename_source_is_undefined", () => {
    // Scenario: a.py was renamed to b.py; requesting the OLD source must not become a new
    // result (the all-files path only exposes final paths), while the destination matches.
    const records = [
        buildTreeToolRecord("A", null, ToolName.Write, { file_path: "/proj/a.py", content: "a = 1\n" }, "2026-01-01T00:00:01Z"),
        buildTreeToolRecord("B", "A", ToolName.Bash, { command: "mv /proj/a.py /proj/b.py" }, "2026-01-01T00:00:02Z"),
        lastPrompt("B"),
    ];
    assert.equal(reconstructSurvivingFileHistory(records, new Path("/proj/a.py")), undefined);
    const viaAllFiles = selectSurvivingHistoryViaAllFiles(records, new Path("/proj/b.py"));
    const viaFastPath = reconstructSurvivingFileHistory(records, new Path("/proj/b.py"));
    assert.ok(viaAllFiles !== undefined);
    assert.deepStrictEqual(viaFastPath, viaAllFiles);
});

test("test_targeted_path_never_reconstructs_unrelated_files_or_rewound_branches", () => {
    // Scenario: the fast path's progress stream mentions ONLY the requested target — no
    // other file's reconstruction, no rewound-branch pass, no script-created discovery.
    const labels: string[] = [];
    setReconstructionProgressSink((event) => {
        labels.push(event.label);
    });
    try {
        const histories = listTargetedSurvivingHistories(buildRewoundRecords(), undefined, new Path("/proj/alpha.py"));
        assert.equal(histories.length, 1);
    } finally {
        setReconstructionProgressSink(undefined);
    }
    assert.ok(labels.length > 0);
    for (const label of labels) {
        assert.ok(!label.includes("gamma.py"), `unrelated file reconstructed: ${label}`);
        assert.ok(!label.includes("reconstructing rewound branch"), `rewound pass ran: ${label}`);
        assert.ok(!label.includes("discovering script-created files"), `discovery pass ran: ${label}`);
    }
});

// The alpha/beta two-source CLI fixture shared by the JSON and text fast-path tests.
function buildTwoSourceCliFixture(suffix: string): { jsonlPaths: string[]; alphaPath: string } {
    const treeA = makeSourceTree(`-target-a${suffix}`);
    const treeB = makeSourceTree(`-target-b${suffix}`);
    const rootA = join(treeA.treeRoot, "ws-a");
    const rootB = join(treeB.treeRoot, "ws-b");
    const alphaPath = join(rootA, "alpha.py");
    const pairA = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: rootA, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_tgt_a", parentUuid: null },
        alphaPath,
        "alpha\n",
    );
    const pairB = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: rootB, timestamp: "2026-07-22T10:05:00.000Z", toolId: "toolu_tgt_b", parentUuid: null },
        join(rootB, "beta.py"),
        "beta\n",
    );
    writeTranscriptFixture(treeA.projectDir, "a.jsonl", pairA.records);
    writeTranscriptFixture(treeB.projectDir, "b.jsonl", pairB.records);
    return { jsonlPaths: [join(treeA.projectDir, "a.jsonl"), join(treeB.projectDir, "b.jsonl")], alphaPath };
}

test("test_targeted_cli_json_emits_one_element_history_array", () => {
    // Scenario: --branch surviving --json --file yields exactly [historyOfTarget], with the
    // other source's file absent from the output.
    const { jsonlPaths, alphaPath } = buildTwoSourceCliFixture("-json");
    const out = runCli([...jsonlPaths, "--branch", "surviving", "--file", alphaPath, "--json"]);
    const parsed = JSON.parse(out) as { target: string; revisions: unknown[] }[];
    assert.equal(parsed.length, 1);
    assert.ok(parsed[0]!.target.endsWith("alpha.py"));
    assert.ok(parsed[0]!.revisions.length > 0);
    assert.ok(!out.includes("beta.py"));
    setPathOverrides({});
});

test("test_targeted_cli_text_mode_renders_only_target", () => {
    // Scenario: the same selection without --json renders only the target's list block.
    const { jsonlPaths, alphaPath } = buildTwoSourceCliFixture("-text");
    const out = runCli([...jsonlPaths, "--branch", "surviving", "--file", alphaPath]);
    assert.ok(out.includes("alpha.py"));
    assert.ok(!out.includes("beta.py"));
    setPathOverrides({});
});
