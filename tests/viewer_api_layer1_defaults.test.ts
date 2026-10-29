// Layer 1 defaults: a bad or missing config file gives "no defaults".

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeLayer1Defaults, DEBUG_CONFIG_PATH } from "../src/viewer_api_layer1_defaults.ts";

// Move the real config aside during the body, and put it back even if the body throws.
function withConfigContents(contents: string | undefined, body: () => void): void {
    const parked = join(mkdtempSync(join(tmpdir(), "jfred-debugconfig-")), "parked.json");
    let hadFile = true;
    try {
        renameSync(DEBUG_CONFIG_PATH, parked);
    } catch {
        hadFile = false;
    }
    try {
        if (contents === undefined) {
            rmSync(DEBUG_CONFIG_PATH, { force: true });
        } else {
            mkdirSync(dirname(DEBUG_CONFIG_PATH), { recursive: true });
            writeFileSync(DEBUG_CONFIG_PATH, contents);
        }
        body();
    } finally {
        rmSync(DEBUG_CONFIG_PATH, { force: true });
        if (hadFile) {
            renameSync(parked, DEBUG_CONFIG_PATH);
        }
    }
}

test("no config file means no defaults", () => {
    withConfigContents(undefined, () => {
        assert.deepEqual(computeLayer1Defaults(), {});
    });
});

test("a config that is not JSON is not an error", () => {
    // A trailing comma is the usual typo; the page must still load with empty boxes.
    withConfigContents('{ "dir": "/a", }', () => {
        assert.equal(computeLayer1Defaults().dir, undefined);
    });
});

test("every field is optional and read independently", () => {
    withConfigContents(JSON.stringify({ dir: "/p/project" }), () => {
        const defaults = computeLayer1Defaults();
        assert.equal(defaults.dir, "/p/project");
        assert.equal(defaults.repo, undefined);
        assert.equal(defaults.jsonl, undefined);
    });
});

test("a full config comes back whole", () => {
    const written = { dir: "/p", repo: "/p", jsonl: ["/j/one", "/j/two"], fileHistory: ["/fh"] };
    withConfigContents(JSON.stringify(written), () => {
        assert.deepEqual(computeLayer1Defaults(), written);
    });
});

test("a field of the wrong shape is dropped, not passed through", () => {
    // A bare-string `jsonl`, or a list holding a number, is a typo: drop it.
    withConfigContents(JSON.stringify({ dir: 42, jsonl: "/j/one", fileHistory: ["/fh", 7] }), () => {
        const defaults = computeLayer1Defaults();
        assert.equal(defaults.dir, undefined);
        assert.equal(defaults.jsonl, undefined);
        assert.equal(defaults.fileHistory, undefined);
    });
});

test("an empty string is not a default", () => {
    // An emptied-out field means "I do not want a default here", not "open on the empty path".
    withConfigContents(JSON.stringify({ dir: "", repo: "/p" }), () => {
        assert.equal(computeLayer1Defaults().dir, undefined);
        assert.equal(computeLayer1Defaults().repo, "/p");
    });
});
