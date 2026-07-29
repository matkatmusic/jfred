// The Layer 1 page's orphan-bucket jump buttons (task 256). The buckets are placed at their earliest member's instant, which on a real project is far down and across a ~156,000 px canvas, so the header carries a shortcut to each.
//
// happy-dom implements NO layout and no scrolling, so nothing here reads a scroll position — that would be measuring happy-dom rather than the page. Every assertion instead observes WHICH element received `scrollIntoView`, the same stub-and-record shape tests/layered-app.test.ts uses for the drawer's jump items. The behaviour under zoom needs no test at all: layer1-zoom.ts applies the NATIVE CSS `zoom` property, so the browser's own scroll positions are already in zoomed pixels and the page contributes no arithmetic that could be wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// webapp/layer1-page.ts calls bootLayer1Page() at MODULE SCOPE, so the first import in this process wires every listener a SECOND time — and one click would then fire two jumps. Absorb that boot here, against a throwaway DOM.
setupLayer1Dom();
const { bootLayer1Page, renderLayer1View } = await import("../webapp/layer1-page.ts");

// The two headings renderLayer1View gives its buckets, and the `data-bucket` values layer1.html's buttons carry. gitOrphans = in the repo, absent from disk; diskOrphans = the mirror.
const GIT_ORPHAN_TITLE = "No on-disk match";
const DISK_ORPHAN_TITLE = "No repository match";

// One rendered view, then a stub on every bucket recording the title of whichever one is scrolled to. Callers pass the orphan rows they want; an EMPTY array is the interesting case, because buildOrphanBucket returns undefined for it and the bucket is never rendered at all.
function openPageWithBuckets(gitOrphanPaths: string[], diskOrphanPaths: string[]): { readScrolledTitle: () => string | undefined } {
    setupLayer1Dom();
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

// Click the header button that aims at `title`. Selecting on `data-bucket` is the test's whole point of contact with the markup: that attribute is the ONLY link between a button and its bucket.
function clickJumpButtonFor(title: string): void {
    const button = document.querySelector<HTMLElement>(`.jumpbar [data-bucket="${title}"]`);
    assert.notEqual(button, null, `no jump button carries data-bucket="${title}"`);
    button!.click();
}

test("test_each_jump_button_scrolls_to_its_own_orphan_bucket", () => {
    // Scenario (task 256): the two buckets are mirror images and a swapped wiring would be invisible on screen, so both directions are asserted — one button must never land on the other's bucket.  Steps: render a view carrying BOTH buckets.
    const page = openPageWithBuckets(["src/gone.ts"], ["build/extra.js"]);
    // the repo-only button lands on the "No on-disk match" bucket.
    clickJumpButtonFor(GIT_ORPHAN_TITLE);
    assert.equal(page.readScrolledTitle(), GIT_ORPHAN_TITLE);
    // and the disk-only button lands on the other one, not on the bucket already visited.
    clickJumpButtonFor(DISK_ORPHAN_TITLE);
    assert.equal(page.readScrolledTitle(), DISK_ORPHAN_TITLE);
});

test("test_a_jump_button_for_an_absent_bucket_is_a_silent_no_op", () => {
    // Scenario (task 256): spec S18 OMITS an empty bucket entirely, but both buttons are in the header from page load — so a view with orphans in only one direction leaves one button with nothing to aim at, and it must not throw.  Steps: render a view whose gitOrphans list is empty, so only ONE bucket exists.
    const page = openPageWithBuckets([], ["build/extra.js"]);
    assert.equal(document.querySelectorAll(".filebox.bucket").length, 1);
    // clicking the button for the missing bucket does nothing and raises nothing.
    clickJumpButtonFor(GIT_ORPHAN_TITLE);
    assert.equal(page.readScrolledTitle(), undefined);
    // the surviving button still works — the miss above left no broken state behind.
    clickJumpButtonFor(DISK_ORPHAN_TITLE);
    assert.equal(page.readScrolledTitle(), DISK_ORPHAN_TITLE);
});
