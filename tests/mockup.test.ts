// Capture-free tests for the Layer 2 mockup checker: the tally and the probe builders.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { RENDER_SIGNATURE, reportCheck, failures, buildShapeProbe } from "../scripts/visual/mockup-checks.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCKUP_DIR = join(HERE, "../../plans/layer2-mockup");
const read = (name: string) => readFileSync(join(MOCKUP_DIR, name), "utf8");

test("check records only the failures", () => {
    const before = failures.length;
    reportCheck("a passing one", true);
    assert.equal(failures.length, before);
    reportCheck("a failing one", false);
    assert.deepEqual(failures.slice(before), ["a failing one"]);
    failures.length = before;
});

test("buildShapeProbe finds the filebox through its .fname child, which carries the data-path", () => {
    assert.match(buildShapeProbe("src/util.ts"), /\.filebox:has\(> \.fname\[data-path="src\/util\.ts"\]\)/);
    assert.ok(buildShapeProbe("src/util.ts").includes("--axis-px"));
});

test("the render signature reads every filebox's path, offset and node rows", () => {
    for (const piece of ["dataset.path", "--axis-px", ".nlabel", ".filebox"]) {
        assert.ok(RENDER_SIGNATURE.includes(piece), piece);
    }
});

test("the mockup is split into three files that reference each other", () => {
    assert.match(read("index.html"), /<script type="module" src="app\.js"><\/script>/);
    assert.match(read("app.js"), /from "\.\/fixture\.js"/);
    assert.ok(!read("index.html").includes("const COMMITS"), "fixture must not be inline any more");
});

test("the fixture exports what app.js imports", () => {
    const fixture = read("fixture.js");
    const imported = read("app.js").match(/import \{([^}]+)\}\s*from "\.\/fixture\.js"/s);
    assert.ok(imported, "app.js must import from fixture.js");
    for (const name of (imported[1] ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
        assert.match(fixture, new RegExp(`export const ${name}\\b`), `fixture.js must export ${name}`);
    }
});

// The fixture throws on load if this breaks; this test fails the suite instead.
test("every snapshot sits between its file's born and its mtime", async () => {
    const { DISK, SNAPSHOTS, ms } = await import(join(MOCKUP_DIR, "fixture.js"));
    for (const snapshot of SNAPSHOTS) {
        const disk = DISK.find((d: { path: string }) => d.path === snapshot.path);
        assert.ok(disk, `${snapshot.path} has no DISK entry`);
        const where = `${snapshot.path} ${snapshot.version}`;
        assert.ok(ms(snapshot.at) >= ms(disk.born), `${where} pre-dates born`);
        assert.ok(ms(snapshot.at) <= ms(disk.at), `${where} post-dates mtime`);
    }
});
