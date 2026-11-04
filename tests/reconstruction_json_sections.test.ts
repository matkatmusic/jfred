import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPhaseTolerantly } from "../src/reconstruction_json_sections.ts";
import { DockerStuckError } from "../src/reconstruction_script_sandbox_docker.ts";

function throwBoom(): number[] {
  throw new Error("boom");
}

function returnOne(): number[] {
  return [1];
}

test("buildPhaseTolerantly returns the phase result when it succeeds", () => {
  assert.deepEqual(buildPhaseTolerantly("ok", [], returnOne), [1]);
});

test("buildPhaseTolerantly returns the fallback when the phase throws", () => {
  assert.deepEqual(buildPhaseTolerantly("bad", [], throwBoom), []);
});

test("buildPhaseTolerantly lets a build-stopping error pass through", () => {
  function throwDockerStuck(): number[] {
    throw new DockerStuckError();
  }
  assert.throws(() => buildPhaseTolerantly("stuck", [], throwDockerStuck), DockerStuckError);
});
