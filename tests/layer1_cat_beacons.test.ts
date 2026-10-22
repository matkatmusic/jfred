// Task 355 step 3: a Bash `cat FILE` result is a Read-like beacon, never a change source.

import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBashCatBeacons } from "../src/layer1_cat_beacons.ts";
import { Path } from "../src/structures/domain.ts";
import { SESSION_A, makeSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";

const CWD = "/work/app";
const SESSION_FILE = new Path("/tmp/session.jsonl");

type BashOutcome = { stdout: string; stderr: string; interrupted: boolean };
const CLEAN_OUTCOME: BashOutcome = { stdout: "line one\nline two\n", stderr: "", interrupted: false };

function buildBashPair(toolId: string, command: string, outcome: BashOutcome): object[] {
    const envelope = { sessionId: SESSION_A, cwd: CWD, timestamp: "2026-07-24T10:00:00.000Z" };
    return [
        {
            ...envelope, type: "assistant", uuid: `${toolId}-a`, parentUuid: null,
            message: { role: "assistant", content: [{ type: "tool_use", id: toolId, name: "Bash", input: { command } }] },
        },
        {
            ...envelope, type: "user", uuid: `${toolId}-r`, parentUuid: `${toolId}-a`,
            message: { role: "user", content: [{ tool_use_id: toolId, type: "tool_result", content: outcome.stdout }] },
            toolUseResult: { ...outcome, isImage: false, noOutputExpected: false },
        },
    ];
}

function collectBeaconsFor(command: string, outcome: BashOutcome = CLEAN_OUTCOME) {
    const tree = makeSourceTree("-cat-project");
    const records = writeTranscriptFixture(tree.projectDir, "a.jsonl", buildBashPair("toolu_cat_1", command, outcome));
    return collectBashCatBeacons(records, SESSION_FILE);
}

test("test_cat_of_one_file_becomes_beacon", () => {
    const beacons = collectBeaconsFor("cat /work/app/src/a.ts");
    assert.equal(beacons.length, 1);
    assert.equal(beacons[0]!.target.toString(), "/work/app/src/a.ts");
    assert.equal(beacons[0]!.changeId.toString(), "toolu_cat_1");
    assert.equal(beacons[0]!.instant.toISOString(), "2026-07-24T10:00:00.000Z");
    assert.equal(beacons[0]!.evidence.line, 2);
});

test("test_cat_with_pipe_or_flags_makes_no_beacon", () => {
    for (const command of ["cat a.ts | head", "cat -n a.ts", "cat a.ts b.ts", "cat a.ts > b.ts", "cat *.ts", "cat $HOME/a.ts", "head a.ts"]) {
        assert.deepEqual(collectBeaconsFor(command), [], command);
    }
});

test("test_cat_with_stderr_or_interrupt_makes_no_beacon", () => {
    assert.deepEqual(collectBeaconsFor("cat a.ts", { ...CLEAN_OUTCOME, stderr: "cat: a.ts: Permission denied" }), []);
    assert.deepEqual(collectBeaconsFor("cat a.ts", { ...CLEAN_OUTCOME, interrupted: true }), []);
    assert.deepEqual(collectBeaconsFor("cat a.ts", { ...CLEAN_OUTCOME, stdout: "" }), []);
});

test("test_relative_cat_path_resolves_against_record_cwd", () => {
    const beacons = collectBeaconsFor("cat src/a.ts");
    assert.equal(beacons[0]!.target.toString(), "/work/app/src/a.ts");
});

test("test_unmodeled_tool_result_makes_no_beacon_and_does_not_throw", () => {
    const envelope = { sessionId: SESSION_A, cwd: CWD, timestamp: "2026-07-24T10:00:00.000Z" };
    const toolSearchPair = [
        {
            ...envelope, type: "assistant", uuid: "toolu_search_1-a", parentUuid: null,
            message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_search_1", name: "ToolSearch", input: { query: "select:Foo" } }] },
        },
        {
            ...envelope, type: "user", uuid: "toolu_search_1-r", parentUuid: "toolu_search_1-a",
            message: { role: "user", content: [{ tool_use_id: "toolu_search_1", type: "tool_result", content: "found" }] },
            toolUseResult: { matches: ["Foo"], query: "select:Foo", total_deferred_tools: 1 },
        },
    ];
    const catPair = buildBashPair("toolu_cat_2", "cat /work/app/src/a.ts", CLEAN_OUTCOME);
    const tree = makeSourceTree("-cat-project");
    const records = writeTranscriptFixture(tree.projectDir, "a.jsonl", [...toolSearchPair, ...catPair]);
    assert.equal(collectBashCatBeacons(records, SESSION_FILE).length, 1);
});

test("test_cat_beacon_content_is_stdout", () => {
    const beacons = collectBeaconsFor("cat a.ts");
    assert.equal(beacons[0]!.content, "line one\nline two\n");
});
