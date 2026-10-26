// Task 316: a file-list click flashes the owning session row; stage is hand-built since happy-dom has no layout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "../webapp/app-dom.ts";
import { flashSession } from "../webapp/layer1-sessions.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function seedSessionRows(...files: string[]): void {
    const host = document.getElementById("sessions")!;
    host.replaceChildren(...files.map((file) => {
        const item = createElement("div", { class: "session-item" });
        item.dataset.file = file;
        return item;
    }));
}

test("test_flashSession_highlights_the_owning_row_as_lead_without_selecting_it", () => {
    initLayer1Dom();
    seedSessionRows("other.jsonl", "owner.jsonl");
    flashSession("owner.jsonl");
    const owner = document.querySelector('[data-file="owner.jsonl"]')!;
    assert.ok(owner.classList.contains("flash"));
    assert.ok(owner.classList.contains("flash-lead"));
    assert.ok(!owner.classList.contains("selected"), "flash must not filter the view");
    assert.ok(!document.querySelector('[data-file="other.jsonl"]')!.classList.contains("flash"));
});

test("test_flashSession_clears_the_previous_lead_so_two_clicks_leave_one", () => {
    // The trap the mockup found: a stale lead marker survives a second click unless every call clears it.
    initLayer1Dom();
    seedSessionRows("a.jsonl", "b.jsonl");
    flashSession("a.jsonl");
    flashSession("b.jsonl");
    assert.equal(document.querySelectorAll(".flash-lead").length, 1);
    assert.ok(document.querySelector('[data-file="b.jsonl"]')!.classList.contains("flash-lead"));
});

test("test_flashSession_removes_the_highlight_after_the_fade", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    initLayer1Dom();
    seedSessionRows("owner.jsonl");
    flashSession("owner.jsonl");
    t.mock.timers.tick(2600);
    const owner = document.querySelector('[data-file="owner.jsonl"]')!;
    assert.ok(!owner.classList.contains("flash"));
    assert.ok(!owner.classList.contains("flash-lead"));
});
