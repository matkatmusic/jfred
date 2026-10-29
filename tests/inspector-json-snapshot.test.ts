// DOM tests for webapp/inspector-json-snapshot.ts: token rendering by on-disk presence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

async function importInspectorJsonSnapshot(): Promise<typeof import("../webapp/inspector-json-snapshot.ts")> {
    initWebappDom();
    return import("../webapp/inspector-json-snapshot.ts");
}

const ENTRY = { relativePath: "src/a.py", backupTime: undefined };

test("test_appendSnapshotToken_renders_missing_suffix_when_blob_absent", async () => {
    // Scenario: a blob known to be absent renders a plain token plus a dimmed suffix.
    const { appendSnapshotToken } = await importInspectorJsonSnapshot();
    const pre = document.createElement("pre");
    const presenceByKey = new Map<string, boolean | undefined>([["s1|blob-1", false]]);
    const context = { sessionId: "s1", presenceByKey, project: "p", openSnapshotDrawer: () => {} };
    appendSnapshotToken(pre, "json-string", '"blob-1"', "blob-1", ENTRY, [], context);
    assert.equal(pre.querySelectorAll(".jump-link").length, 0);
    assert.ok(pre.textContent!.includes("(missing from disk)"));
});

test("test_appendSnapshotToken_opens_drawer_when_blob_present", async () => {
    // Scenario: a present blob renders a jump-link that opens the snapshot drawer.
    const { appendSnapshotToken } = await importInspectorJsonSnapshot();
    const pre = document.createElement("pre");
    const opened: string[] = [];
    const presenceByKey = new Map<string, boolean | undefined>([["s1|blob-1", true]]);
    const context = { sessionId: "s1", presenceByKey, project: "p", openSnapshotDrawer: (blobName: string) => opened.push(blobName) };
    appendSnapshotToken(pre, "json-string", '"blob-1"', "blob-1", ENTRY, [], context);
    const link = pre.querySelector(".jump-link") as HTMLElement;
    link.click();
    assert.deepEqual(opened, ["blob-1"]);
});
