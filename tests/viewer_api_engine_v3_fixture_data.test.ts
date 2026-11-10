// Test for src/viewer_api_engine_v3_fixture_data.ts: fixture commits and six fake Session steps, one list by time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMITS, DISK, parseMs } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";
import { buildFixtureEngineV3Steps } from "../src/viewer_api_engine_v3_fixture_data.ts";
import { EngineV3StepKind } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";

type Step = ReturnType<typeof buildFixtureEngineV3Steps>[number];

function listSessionSteps(): Step[] {
    const sessionSteps: Step[] = [];
    for (const step of buildFixtureEngineV3Steps()) {
        const isSessionStep = step.kind !== EngineV3StepKind.commit;
        if (isSessionStep) {
            sessionSteps.push(step);
        }
    }
    return sessionSteps;
}

test("test_each_session_step_kind_appears_exactly_once", () => {
    // Steps: list the kinds of the Session steps in time order, compare with the six kinds.
    const kinds = listSessionSteps().map((step) => step.kind);
    assert.deepEqual(kinds, [
        EngineV3StepKind.noFileChange, EngineV3StepKind.edit, EngineV3StepKind.script,
        EngineV3StepKind.snapshot, EngineV3StepKind.rewindCode, EngineV3StepKind.rewindChatOnly,
    ]);
});

test("test_every_fixture_commit_is_a_commit_step_with_its_hash_and_time", () => {
    // Steps: list the commit steps, compare each with the COMMITS row of the same hash.
    const hashes: string[] = [];
    for (const step of buildFixtureEngineV3Steps()) {
        const row = COMMITS.find((commit) => commit.hash === step.nodeId.toString());
        if (step.kind === EngineV3StepKind.commit) {
            assert.ok(row, `no fixture commit ${step.nodeId}`);
            assert.equal(step.nodeTime.getTime(), parseMs(row.at));
            hashes.push(row.hash);
        }
    }
    const commitsByTime = [...COMMITS].sort((left, right) => parseMs(left.at) - parseMs(right.at));
    assert.deepEqual(hashes, commitsByTime.map((commit) => commit.hash));
});

test("test_the_list_starts_with_the_first_commit_in_the_repo", () => {
    const first = buildFixtureEngineV3Steps()[0]!;
    assert.equal(first.kind, EngineV3StepKind.commit);
    assert.equal(first.nodeId.toString(), COMMITS[0]!.hash);
    assert.ok(first.sentence.includes("first commit in the repo"));
});

test("test_a_commit_step_says_it_overwrites_the_commit_files_and_lists_them", () => {
    // Steps: each commit step says overwrites and names every file of its commit.
    for (const step of buildFixtureEngineV3Steps()) {
        if (step.kind === EngineV3StepKind.commit) {
            const row = COMMITS.find((commit) => commit.hash === step.nodeId.toString())!;
            assert.deepEqual(step.filesChanged, row.files);
            assert.ok(step.sentence.includes("overwrites"));
            for (const path of row.files) {
                assert.ok(step.sentence.includes(path), `${path} is not in: ${step.sentence}`);
            }
        }
    }
});

test("test_every_session_step_sits_on_a_session_column_node_with_the_same_time", () => {
    // Steps: find each Session step's node in the fixture annotations, compare the times.
    const annotations = buildFixtureLayer1View().annotations!;
    for (const step of listSessionSteps()) {
        const node = annotations.find((annotation) => annotation.id.toString() === step.nodeId.toString());
        assert.ok(node, `no Session column node ${step.nodeId}`);
        assert.equal(node.instant.getTime(), step.nodeTime.getTime());
    }
});

test("test_steps_are_in_time_order_with_a_commit_first_on_a_tie", () => {
    const steps = buildFixtureEngineV3Steps();
    const times = steps.map((step) => step.nodeTime.getTime());
    assert.deepEqual(times, [...times].sort((left, right) => left - right));
    assert.equal(steps[0]!.kind, EngineV3StepKind.commit);
});

test("test_every_changed_file_of_a_session_step_exists_before_the_step", () => {
    // Steps: each changed file is born before its step; commit steps are skipped.
    for (const step of listSessionSteps()) {
        for (const path of step.filesChanged) {
            const file = DISK.find((row) => row.path === path);
            assert.ok(file, `${path} is not a fixture file`);
            assert.ok(parseMs(file.born) < step.nodeTime.getTime(), `${path} is born after its step`);
        }
    }
});

test("test_only_the_session_steps_that_change_files_list_files", () => {
    for (const step of listSessionSteps()) {
        const changesNoFile = step.kind === EngineV3StepKind.noFileChange || step.kind === EngineV3StepKind.rewindChatOnly;
        assert.equal(step.filesChanged.length === 0, changesNoFile);
    }
});
