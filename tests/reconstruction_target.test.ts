import { test } from "node:test";
import assert from "node:assert/strict";
import {
    listTargetedSurvivingHistories,
    getSurvivingFileHistory,
} from "../src/reconstruction_target.ts";
import { reconstructBranches } from "../src/reconstruction_engine.ts";
import type { FileHistory } from "../src/reconstruction_events.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { lastPrompt } from "./reconstruction-branch-test-helpers.ts";

// An assistant record on the parentUuid tree carrying one timestamped tool_use.
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

// The all-files path's answer for one target, which the targeted fast path must reproduce exactly.
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
    // Scenario: on a linear conversation the fast path equals the all-branch history for the same path.
    const records = buildTwoFileRecords();
    const target = new Path("/proj/alpha.py");
    // reconstruct via both paths and deep-compare the parsed structures.
    const viaAllFiles = selectSurvivingHistoryViaAllFiles(records, target);
    const viaFastPath = getSurvivingFileHistory(records, target);
    assert.ok(viaAllFiles !== undefined);
    assert.deepStrictEqual(viaFastPath, viaAllFiles);
});

test("test_targeted_history_matches_allfiles_with_rewound_branch", () => {
    // Scenario: with a rewound branch, the fast path still equals the all-branch answer; gamma.py must not leak.
    const records = buildRewoundRecords();
    const target = new Path("/proj/alpha.py");
    const viaAllFiles = selectSurvivingHistoryViaAllFiles(records, target);
    const viaFastPath = getSurvivingFileHistory(records, target);
    assert.ok(viaAllFiles !== undefined);
    assert.deepStrictEqual(viaFastPath, viaAllFiles);
});

test("test_targeted_history_for_absent_target_is_undefined", () => {
    // Scenario: a path no evidence touches yields undefined, matching the all-files path's empty filter.
    const records = buildTwoFileRecords();
    const target = new Path("/proj/missing.py");
    assert.equal(selectSurvivingHistoryViaAllFiles(records, target), undefined);
    assert.equal(getSurvivingFileHistory(records, target), undefined);
});

test("test_targeted_history_for_old_rename_source_is_undefined", () => {
    // Scenario: after a.py is renamed to b.py, the old source gives undefined and the destination matches.
    const records = [
        buildTreeToolRecord("A", null, ToolName.Write, { file_path: "/proj/a.py", content: "a = 1\n" }, "2026-01-01T00:00:01Z"),
        buildTreeToolRecord("B", "A", ToolName.Bash, { command: "mv /proj/a.py /proj/b.py" }, "2026-01-01T00:00:02Z"),
        lastPrompt("B"),
    ];
    assert.equal(getSurvivingFileHistory(records, new Path("/proj/a.py")), undefined);
    const viaAllFiles = selectSurvivingHistoryViaAllFiles(records, new Path("/proj/b.py"));
    const viaFastPath = getSurvivingFileHistory(records, new Path("/proj/b.py"));
    assert.ok(viaAllFiles !== undefined);
    assert.deepStrictEqual(viaFastPath, viaAllFiles);
});

test("test_targeted_path_never_reconstructs_unrelated_files_or_rewound_branches", () => {
    // Scenario: the fast path's progress stream mentions only the requested target.
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
