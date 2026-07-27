// The Layer 1 View's cold-start defaults, read from the gitignored .config/debugConfig.json.
//
// The file is hand-edited and absent on every machine but the author's, so what matters is that a
// missing, malformed or half-typed one degrades to "no defaults" rather than reaching the client as
// something it will try to render. The reader is the only trust boundary the Layer 1 page has that
// no HTTP validation sits in front of.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeLayer1Defaults, DEBUG_CONFIG_PATH } from "../src/viewer_api_layer1_defaults.ts";

// The real file is on the author's machine only, and a test must not read or destroy it — so it is
// moved aside for the duration and put back, whether the body passed or threw.
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
    // The normal way to break a hand-edited file is a trailing comma. It must not stop the server
    // answering — the page loads with empty boxes, exactly as it did before this file existed.
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
    // `jsonl` as a bare string, or a list holding a number, is a typo — the page expects an array
    // of strings and would render the mistake rather than ignoring it.
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
