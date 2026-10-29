// Step 4a of the S18 fixes: tests the streamed path (progress=1) of src/viewer_api_layer1_route.ts.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { sendNdjsonBuild } from "../src/viewer_api_layer1_route.ts";
import {
    buildViewUrl,
    createFixtureDiskFolder,
    createFixtureRepo,
    launchFixtureViewer,
    type WireLayer1View,
} from "./layer1-view-test-helpers.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";

// Ports 17400, 17900, 18400, 18900, 19400 and 19900 are taken by other test files.
const SCRATCH_PORT = 20400 + (process.pid % 500);

// One parsed NDJSON line: a progress or error line carries `kind`, the terminal view carries none.
type StreamLine = Partial<WireLayer1View> & {
    kind?: DocumentResponseKind;
    label?: string;
    current?: number;
    total?: number;
};

const diskDir = createFixtureDiskFolder();
const repoDir = createFixtureRepo();
let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await launchFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

// Every line of the streamed response, in arrival order; chunk boundaries are tested elsewhere.
async function readStreamLines(parameters: Record<string, string>): Promise<StreamLine[]> {
    const response = await fetch(buildViewUrl(SCRATCH_PORT, { ...parameters, progress: "1" }));
    assert.equal(response.status, 200);
    const body = await response.text();
    return body.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as StreamLine);
}

test("test_layer1_view_stream_ends_with_the_same_view_the_plain_route_returns", async () => {
    // Scenario: `progress=1` changes only the framing, never the view; compare plain and streamed forms.
    const plain = await (await fetch(buildViewUrl(SCRATCH_PORT, { dir: diskDir, repo: repoDir }))).json();
    const lines = await readStreamLines({ dir: diskDir, repo: repoDir });
    // the stream's terminal line is the view, carrying NO kind discriminant...
    const terminal = lines.at(-1)!;
    assert.equal(terminal.kind, undefined);
    // ...and it is byte-for-byte the plain route's body.
    assert.deepEqual(terminal, plain);
});

test("test_layer1_view_stream_emits_a_counted_progress_line_before_the_view", async () => {
    // Scenario: every progress line carries current/total and arrives before the terminal view line.
    const lines = await readStreamLines({ dir: diskDir, repo: repoDir });
    const progressLines = lines.filter((line) => line.kind === DocumentResponseKind.progress);
    // at least one progress line carries a numeric current AND total.
    const counted = progressLines.filter((line) => typeof line.current === "number" && typeof line.total === "number");
    assert.ok(counted.length > 0, `no counted progress line in ${lines.length} lines`);
    // every progress line precedes the terminal line: the LAST line, the only one without a kind.
    const terminalIndex = lines.length - 1;
    assert.equal(lines[terminalIndex]!.kind, undefined);
    assert.equal(lines.filter((line) => line.kind === undefined).length, 1);
    for (const [index, line] of lines.entries()) {
        assert.equal(index < terminalIndex, line.kind !== undefined, `line ${index} is on the wrong side of the view`);
    }
});

test("test_layer1_view_stream_reports_an_unresolvable_ref_as_a_terminal_error_line", async () => {
    // Scenario: a bad ref on the streamed path becomes a terminal error line, not a 400.
    const lines = await readStreamLines({ dir: diskDir, repo: repoDir, ref: "no-such-ref" });
    const terminal = lines.at(-1)!;
    // the last line is an error line...
    assert.equal(terminal.kind, DocumentResponseKind.error);
    // ...whose label names the offending ref, so the crumb tells the user what to fix.
    assert.ok(terminal.label?.includes("no-such-ref"), terminal.label);
    // ...and the label is the bare message, since the client wraps it in its own Error.
    assert.ok(!terminal.label?.startsWith("Error: "), terminal.label);
    // and no view was emitted alongside it.
    assert.equal(terminal.pairs, undefined);
});

test("test_layer1_stream_leaves_neither_the_response_nor_the_socket_corked_after_a_progress_line", async () => {
    // Scenario: newer Node corks the response after write, so both response and socket must uncork.
    const recordedCorks: number[] = [];
    const server: Server = createServer((_request, response) => {
        sendNdjsonBuild(response, (writeNdjsonLine) => {
            writeNdjsonLine({ kind: DocumentResponseKind.progress, label: "probe" });
            recordedCorks.push(response.writableCorked, response.socket!.writableCorked);
            return { done: true };
        });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
        await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)).text();
    } finally {
        server.close();
    }
    // both the response and the socket are uncorked right after the write.
    assert.deepEqual(recordedCorks, [0, 0]);
});
