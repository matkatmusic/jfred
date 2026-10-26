// Task 256: the orphan-bucket jump buttons. Assertions observe which element received `scrollIntoView`, since happy-dom has no layout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb the first import against a throwaway DOM.
initLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");

// The two bucket headings renderLayer1View uses, matching the `data-bucket` values on layer1.html's buttons.
const GIT_ORPHAN_TITLE = "No on-disk match";
const DISK_ORPHAN_TITLE = "No repository match";

// Render one view, stub every bucket to record the scrolled title; an empty array renders no bucket.
function openPageWithBuckets(gitOrphanPaths: string[], diskOrphanPaths: string[]): { readScrolledTitle: () => string | undefined } {
    initLayer1Dom();
    bootLayer1Page();
    const toRows = (paths: string[]) =>
        paths.map((path, index) => ({ path, instant: "2026-07-25T10:00:00.000Z", axisPx: 100 + index }));
    renderLayer1View({
        pairs: [],
        gitOrphans: toRows(gitOrphanPaths),
        diskOrphans: toRows(diskOrphanPaths),
        ruler: [],
    });
    let scrolledTitle: string | undefined;
    for (const bucket of document.querySelectorAll<HTMLElement>(".filebox.bucket")) {
        const title = bucket.querySelector(".fname")?.textContent ?? undefined;
        bucket.scrollIntoView = () => { scrolledTitle = title; };
    }
    return { readScrolledTitle: () => scrolledTitle };
}

// Click the header button that aims at `title`; `data-bucket` is the only link between a button and its bucket.
function clickJumpButtonFor(title: string): void {
    const button = document.querySelector<HTMLElement>(`.jumpbar [data-bucket="${title}"]`);
    assert.notEqual(button, null, `no jump button carries data-bucket="${title}"`);
    button!.click();
}

test("test_each_jump_button_scrolls_to_its_own_orphan_bucket", () => {
    // Scenario (task 256): a swapped wiring is invisible on screen, so each button must land on its own bucket.
    const page = openPageWithBuckets(["src/gone.ts"], ["build/extra.js"]);
    // the repo-only button lands on the "No on-disk match" bucket.
    clickJumpButtonFor(GIT_ORPHAN_TITLE);
    assert.equal(page.readScrolledTitle(), GIT_ORPHAN_TITLE);
    // and the disk-only button lands on the other one, not on the bucket already visited.
    clickJumpButtonFor(DISK_ORPHAN_TITLE);
    assert.equal(page.readScrolledTitle(), DISK_ORPHAN_TITLE);
});

test("test_a_jump_button_for_an_absent_bucket_is_a_silent_no_op", () => {
    // Scenario (task 256): an empty bucket is omitted, so its button has no target and must not throw.
    const page = openPageWithBuckets([], ["build/extra.js"]);
    assert.equal(document.querySelectorAll(".filebox.bucket").length, 1);
    // clicking the button for the missing bucket does nothing and raises nothing.
    clickJumpButtonFor(GIT_ORPHAN_TITLE);
    assert.equal(page.readScrolledTitle(), undefined);
    // the surviving button still works — the miss above left no broken state behind.
    clickJumpButtonFor(DISK_ORPHAN_TITLE);
    assert.equal(page.readScrolledTitle(), DISK_ORPHAN_TITLE);
});
