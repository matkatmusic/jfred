// DOM tests for webapp/views/download.ts: the text goes to disk through a transient object URL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_saveTextFile_clicks_a_download_link_then_revokes_the_object_url", async () => {
    initWebappDom();
    const calls: string[] = [];
    const link = { href: "", download: "", click: () => calls.push("click") };
    Object.assign(globalThis.URL, {
        createObjectURL: () => {
            calls.push("create");
            return "blob:fake";
        },
        revokeObjectURL: (url: string) => calls.push(`revoke ${url}`),
    });
    document.createElement = (() => link) as unknown as typeof document.createElement;
    const { saveTextFile } = await import("../webapp/views/download.ts");
    saveTextFile("notes.txt", "hello");
    assert.equal(link.href, "blob:fake");
    assert.equal(link.download, "notes.txt");
    assert.deepEqual(calls, ["create", "click", "revoke blob:fake"]);
});
