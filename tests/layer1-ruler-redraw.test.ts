import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyRulerRedrawn, registerRulerRedrawListener } from "../webapp/layer1-components/ruler/layer1-ruler-redraw.ts";

test("test_a_registered_listener_runs_once_per_notify", () => {
    // Scenario: one registered listener runs once for each notify.
    let callCount = 0;
    registerRulerRedrawListener(() => {
        callCount += 1;
    });
    // No notify yet: the listener has not run.
    assert.equal(callCount, 0);
    // First notify: one run.
    notifyRulerRedrawn();
    assert.equal(callCount, 1);
    // Second notify: two runs.
    notifyRulerRedrawn();
    assert.equal(callCount, 2);
});

test("test_listeners_run_in_registration_order", () => {
    // Scenario: two listeners registered one after the other run in that order.
    const calls: string[] = [];
    registerRulerRedrawListener(() => calls.push("first"));
    registerRulerRedrawListener(() => calls.push("second"));
    notifyRulerRedrawn();
    // The listener of the other test also ran; keep only these two.
    assert.deepEqual(calls, ["first", "second"]);
});
