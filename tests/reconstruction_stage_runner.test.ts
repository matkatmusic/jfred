import { test } from "node:test";
import assert from "node:assert/strict";
import { executeStageTolerantly, rethrowBuildStoppingError } from "../src/reconstruction_stage_runner.ts";
import { DockerStuckError, DockerUnavailableError } from "../src/reconstruction_script_sandbox_docker.ts";
import { EarlierRunNotSavedError } from "../src/reconstruction_script_sandbox_spawn_guard.ts";
import { clearReconstructionFailures, popReconstructionFailures } from "../src/reconstruction_health.ts";
import { Path } from "../src/structures/domain.ts";
import { FailureScope } from "../src/structures/vocabulary_views.ts";
import type { FileEvent } from "../src/reconstruction_events.ts";

const TARGET = new Path("/proj/a.txt");

test("test_executeStageTolerantly_returns_the_stage_result_and_passes_args", () => {
    clearReconstructionFailures();
    const output: FileEvent[] = [];
    const seenArgs: number[] = [];
    function runStage(first: number, second: number): FileEvent[] {
        seenArgs.push(first, second);
        return output;
    }
    const result = executeStageTolerantly("s", TARGET, [], runStage, 1, 2);
    assert.equal(result, output);
    assert.deepEqual(seenArgs, [1, 2]);
    assert.equal(popReconstructionFailures().length, 0);
});

test("test_executeStageTolerantly_returns_the_input_and_notes_a_failure_on_throw", () => {
    clearReconstructionFailures();
    const input: FileEvent[] = [];
    function runFailingStage(): FileEvent[] {
        throw new Error("boom");
    }
    const result = executeStageTolerantly("badStage", TARGET, input, runFailingStage);
    assert.equal(result, input);
    const failures = popReconstructionFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.scope, FailureScope.fileStage);
    assert.equal(failures[0]?.stage, "badStage");
});

const BUILD_STOPPING_ERRORS: Error[] = [new DockerUnavailableError(), new DockerStuckError(), new EarlierRunNotSavedError(" label")];

for (const stoppingError of BUILD_STOPPING_ERRORS) {
    test(`test_executeStageTolerantly_rethrows_${stoppingError.constructor.name}_and_notes_no_failure`, () => {
        clearReconstructionFailures();
        function runStoppingStage(): FileEvent[] {
            throw stoppingError;
        }
        assert.throws(() => executeStageTolerantly("s", TARGET, [], runStoppingStage), stoppingError);
        assert.equal(popReconstructionFailures().length, 0);
    });
}

test("test_rethrowBuildStoppingError_ignores_a_plain_error", () => {
    assert.doesNotThrow(() => rethrowBuildStoppingError(new Error("boom")));
});
