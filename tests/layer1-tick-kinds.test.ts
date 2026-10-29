// markTickKindState gives a tick with no events an empty dash holder and no multi or hidden class.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "../webapp/app-dom.ts";
import { KIND_HIDDEN_CLASS } from "../webapp/layer1-kind-filter.ts";
import { markTickKindState } from "../webapp/layer1-tick-kinds.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

test("markTickKindState leaves an event-less tick unmarked with an empty dash holder", () => {
    initLayer1Dom();
    const tick = createElement("div", { class: "tick", text: "06-02 09:00:00" });
    document.getElementById("ruler")!.appendChild(tick);
    markTickKindState([]);
    assert.equal(tick.classList.contains("multi"), false);
    assert.equal(tick.classList.contains(KIND_HIDDEN_CLASS), false);
    assert.equal(tick.querySelectorAll(".kind-dashes").length, 1);
    assert.equal(tick.querySelectorAll(".kind-dashes i").length, 0);
});
