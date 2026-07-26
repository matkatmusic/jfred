// The Layer 1 page's three header source boxes and their folder pickers (webapp/layer1-sources.ts),
// split out of layer1-page.ts when that file reached the enforced 250-line ceiling.
//
// These three exports are what makes ?dir=&repo=&ref= a working shareable link, so they are tested
// against the REAL layer1.html markup (setupLayer1Dom reads the file) rather than a hand-built form
// — a renamed id or a dropped `data-for` is exactly the regression that would otherwise ship silent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { fillSourceBoxesFromUrl, readSourceParams, wireFolderPickers } from "../webapp/layer1-sources.ts";

function readBoxValue(id: string): string {
    return (document.getElementById(id) as HTMLInputElement).value;
}

function writeBoxValue(id: string, value: string): void {
    (document.getElementById(id) as HTMLInputElement).value = value;
}

test("test_source_boxes_round_trip_the_query_string", () => {
    // Scenario: a ?dir=&repo=&ref= link opens with its three boxes already filled, and reading them
    // back yields the same params — the two halves of S18's "one shareable link".
    // Steps:
    // open the page on a fully-specified link.
    setupLayer1Dom("?dir=/w/projects&repo=/w/repo&ref=develop");
    fillSourceBoxesFromUrl();
    // every box carries its own param, decoded.
    assert.equal(readBoxValue("dir"), "/w/projects");
    assert.equal(readBoxValue("repo"), "/w/repo");
    assert.equal(readBoxValue("ref"), "develop");
    // and reading them back reproduces the query the page was opened on.
    assert.equal(readSourceParams().toString(), new URLSearchParams({
        dir: "/w/projects",
        repo: "/w/repo",
        ref: "develop",
    }).toString());
});

test("test_a_blank_or_whitespace_box_contributes_no_param", () => {
    // Scenario: the ref box is OPTIONAL — the endpoint reads an absent ref as the repo's active
    // branch, so an empty box must be omitted rather than sent as ref="". Whitespace is the same
    // case: a stray space would otherwise become a ref nothing resolves.
    // Steps:
    // open an unseeded page and fill only the two required boxes, leaving ref whitespace.
    setupLayer1Dom();
    writeBoxValue("dir", "/w/projects");
    writeBoxValue("repo", "/w/repo");
    writeBoxValue("ref", "   ");
    const params = readSourceParams();
    // ref is absent entirely, and the two real values are trimmed of nothing they need.
    assert.equal(params.has("ref"), false);
    assert.equal(params.get("dir"), "/w/projects");
    assert.equal(params.get("repo"), "/w/repo");
});

test("test_an_unseeded_box_keeps_whatever_the_user_typed", () => {
    // Scenario: fillSourceBoxesFromUrl runs on every boot, including after a pick. A param the URL
    // does NOT carry must leave its box alone — clearing it would wipe a folder the user just chose.
    // Steps:
    // type into all three boxes, then open on a link that names only dir.
    setupLayer1Dom("?dir=/w/from-url");
    writeBoxValue("dir", "/w/typed");
    writeBoxValue("repo", "/w/kept-repo");
    writeBoxValue("ref", "kept-ref");
    fillSourceBoxesFromUrl();
    // dir is overwritten by the URL; the two the URL never mentioned survive.
    assert.equal(readBoxValue("dir"), "/w/from-url");
    assert.equal(readBoxValue("repo"), "/w/kept-repo");
    assert.equal(readBoxValue("ref"), "kept-ref");
});

test("test_a_picked_folder_lands_in_its_own_box_and_redraws_once", async () => {
    // Scenario: each `button.pick` is bound to the box named by its `data-for`, so clicking the repo
    // picker must not write into the dir box. The redraw callback is what re-runs the view, and it
    // must fire exactly once per successful pick.
    // Steps:
    // stub the picker endpoint and wire the buttons against the real markup.
    setupLayer1Dom();
    globalThis.fetch = (async () => new Response(JSON.stringify({ path: "/w/picked-repo" }))) as typeof fetch;
    let redraws = 0;
    wireFolderPickers(() => {
        redraws += 1;
    });
    // click the REPO picker specifically.
    (document.querySelector('button.pick[data-for="repo"]') as HTMLButtonElement).click();
    await flushAsyncWork();
    // the picked path landed in repo, dir was untouched, and the view was asked to redraw once.
    assert.equal(readBoxValue("repo"), "/w/picked-repo");
    assert.equal(readBoxValue("dir"), "");
    assert.equal(redraws, 1);
});

test("test_a_cancelled_pick_leaves_the_box_alone", async () => {
    // Scenario: GET /api/pick-folder answers a cancelled native dialog with an EMPTY path. Writing
    // that through would erase a folder the user had already chosen, so it must be a no-op.
    // Steps: this is the empty-path branch of pickFolderInto, asserted through the same click path.
    setupLayer1Dom();
    writeBoxValue("dir", "/w/already-chosen");
    globalThis.fetch = (async () => new Response(JSON.stringify({ path: "" }))) as typeof fetch;
    wireFolderPickers(() => {});
    (document.querySelector('button.pick[data-for="dir"]') as HTMLButtonElement).click();
    // WITHOUT this the pick has not resolved yet and the assertion below proves nothing.
    await flushAsyncWork();
    assert.equal(readBoxValue("dir"), "/w/already-chosen");
});
