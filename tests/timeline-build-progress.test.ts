// timeline-build-progress.ts: the frame wait between row batches (thresholds and labels live in timeline-sessions-progress.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForNextAnimationFrame } from "../webapp/views/timeline-build-progress.ts";

test("test_waitForNextAnimationFrame_resolves_only_after_the_frame_callback_runs", async () => {
    // Behavior: the wait stays pending until a fake frame callback runs.
    const frameCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => frameCallbacks.push(callback);
    let isResolved = false;
    const waiting = waitForNextAnimationFrame().then(() => {
        isResolved = true;
    });
    await Promise.resolve();
    assert.equal(frameCallbacks.length, 1);
    assert.equal(isResolved, false);
    frameCallbacks[0]!(0);
    await waiting;
    assert.equal(isResolved, true);
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
});
