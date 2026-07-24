// The task-194 reconstruction-mode choice: per-project sessionStorage round-trip, and the
// server-relaunch boot-id sweep forgetting it like every other per-project choice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWebappDom } from "./webapp-dom-test-helpers.ts";
import { storeModeChoice, getModeChoice, clearModeChoice, reconcileServerBootId } from "../webapp/app-choices.ts";

setupWebappDom();

test("mode_choice_round_trips_full_and_bounded", () => {
    clearModeChoice("proj-a");
    assert.equal(getModeChoice("proj-a"), null);
    storeModeChoice("proj-a", { mode: "full" });
    assert.deepEqual(getModeChoice("proj-a"), { mode: "full" });
    storeModeChoice("proj-a", { mode: "bounded", file: "/repo/plate_cli.py", nth: 3 });
    assert.deepEqual(getModeChoice("proj-a"), { mode: "bounded", file: "/repo/plate_cli.py", nth: 3 });
    clearModeChoice("proj-a");
    assert.equal(getModeChoice("proj-a"), null);
});

test("boot_id_change_forgets_the_mode_choice", () => {
    reconcileServerBootId("boot-one");
    storeModeChoice("proj-b", { mode: "bounded", file: "/repo/a.py", nth: 1 });
    // Same boot id: the choice survives.
    reconcileServerBootId("boot-one");
    assert.notEqual(getModeChoice("proj-b"), null);
    // A relaunched server (new boot id) sweeps every per-project choice, mode included.
    reconcileServerBootId("boot-two");
    assert.equal(getModeChoice("proj-b"), null);
});
