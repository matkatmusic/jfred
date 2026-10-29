// The Layer 1 header source boxes and folder pickers, tested against the real layer1.html markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { fillSourceBoxesFromUrl, readSourceParams, attachFolderPickers } from "../webapp/layer1-sources.ts";

function readBoxValue(id: string): string {
    return (document.getElementById(id) as HTMLInputElement).value;
}

function writeBoxValue(id: string, value: string): void {
    (document.getElementById(id) as HTMLInputElement).value = value;
}

test("test_source_boxes_round_trip_the_query_string", () => {
    // Scenario: a fully-specified link fills the three boxes, and reading them back yields the same params.
    initLayer1Dom("?dir=/w/projects&repo=/w/repo&ref=develop");
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
    // Scenario: a blank or whitespace ref box is omitted from the params, not sent as ref="".
    initLayer1Dom();
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
    // Scenario: a param the URL does not carry leaves its typed box alone.
    initLayer1Dom("?dir=/w/from-url");
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
    // Scenario: a picker fills only its own `data-for` box and fires the redraw callback once.
    initLayer1Dom();
    globalThis.fetch = (async () => new Response(JSON.stringify({ path: "/w/picked-repo" }))) as typeof fetch;
    let redraws = 0;
    attachFolderPickers(() => {
        redraws += 1;
    });
    // click the REPO picker specifically.
    (document.querySelector('button.pick[data-for="repo"]') as HTMLButtonElement).click();
    await waitForAsyncWork();
    // the picked path landed in repo, dir was untouched, and the view was asked to redraw once.
    assert.equal(readBoxValue("repo"), "/w/picked-repo");
    assert.equal(readBoxValue("dir"), "");
    assert.equal(redraws, 1);
});

test("test_a_cancelled_pick_leaves_the_box_alone", async () => {
    // Scenario: a cancelled dialog returns an empty path, which must not erase the chosen folder.
    initLayer1Dom();
    writeBoxValue("dir", "/w/already-chosen");
    globalThis.fetch = (async () => new Response(JSON.stringify({ path: "" }))) as typeof fetch;
    attachFolderPickers(() => {});
    (document.querySelector('button.pick[data-for="dir"]') as HTMLButtonElement).click();
    // WITHOUT this the pick has not resolved yet and the assertion below proves nothing.
    await waitForAsyncWork();
    assert.equal(readBoxValue("dir"), "/w/already-chosen");
});
