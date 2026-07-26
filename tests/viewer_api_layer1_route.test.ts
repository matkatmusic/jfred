// Step 4a of the S18 Layer 1 feedback fixes: GET /api/layer1-view?progress=1 serves the view as an
// NDJSON stream so the page can draw a determinate bar during the route's ~10 s build.
//
// This file owns the STREAMED path of src/viewer_api_layer1_route.ts. The PLAIN path's three
// bad-input 400s stay in tests/viewer_api_layer1.test.ts, unchanged — a bad `dir`/`repo` must keep
// 400-ing even when the caller asked for a stream, which is why both folder checks run before any
// header is written.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import {
    buildViewUrl,
    makeFixtureDiskFolder,
    makeFixtureRepo,
    startFixtureViewer,
    type WireLayer1View,
} from "./layer1-view-test-helpers.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary.ts";

// 17400 (viewer_server.test.ts), 17900 (viewer_api_layered.test.ts), 18400 (viewer_api_ladder), 18900
// (viewer_api_layer1), 19400 (viewer_api_layer1_placement) and 19900 (layer1-acceptance) are taken —
// parallel test files must never collide.
const SCRATCH_PORT = 20400 + (process.pid % 500);

// One parsed NDJSON line: a progress or error line carries `kind`, the terminal view carries none.
type StreamLine = Partial<WireLayer1View> & {
    kind?: DocumentResponseKind;
    label?: string;
    current?: number;
    total?: number;
};

const diskDir = makeFixtureDiskFolder();
const repoDir = makeFixtureRepo();
let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await startFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

// Every line of the streamed response, in arrival order. The whole body is read before splitting:
// this asserts CONTENT, and chunk boundaries are already covered by splitNdjsonChunk's own test.
async function readStreamLines(parameters: Record<string, string>): Promise<StreamLine[]> {
    const response = await fetch(buildViewUrl(SCRATCH_PORT, { ...parameters, progress: "1" }));
    assert.equal(response.status, 200);
    const body = await response.text();
    return body.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as StreamLine);
}

test("test_layer1_view_stream_ends_with_the_same_view_the_plain_route_returns", async () => {
    // Scenario: `progress=1` changes only the FRAMING, never the view. This is what freezes the two
    // paths together — a divergence would let the streamed page render something the plain endpoint
    // (and every other server test in this suite) never sees.
    // Steps:
    // fetch the plain form and the streamed form of the same request.
    const plain = await (await fetch(buildViewUrl(SCRATCH_PORT, { dir: diskDir, repo: repoDir }))).json();
    const lines = await readStreamLines({ dir: diskDir, repo: repoDir });
    // the stream's terminal line is the view, carrying NO kind discriminant...
    const terminal = lines.at(-1)!;
    assert.equal(terminal.kind, undefined);
    // ...and it is byte-for-byte the plain route's body.
    assert.deepEqual(terminal, plain);
});

test("test_layer1_view_stream_emits_a_counted_progress_line_before_the_view", async () => {
    // Scenario: a determinate bar needs a current/total, and every progress line must arrive BEFORE
    // the terminal view — a progress line after it would advance a bar the page has already hidden.
    // Steps:
    // read the streamed form of the fixture request.
    const lines = await readStreamLines({ dir: diskDir, repo: repoDir });
    const progressLines = lines.filter((line) => line.kind === DocumentResponseKind.progress);
    // at least one progress line carries a numeric current AND total.
    const counted = progressLines.filter((line) => typeof line.current === "number" && typeof line.total === "number");
    assert.ok(counted.length > 0, `no counted progress line in ${lines.length} lines`);
    // every progress line precedes the terminal line, which is the LAST line and the only one
    // without a kind.
    const terminalIndex = lines.length - 1;
    assert.equal(lines[terminalIndex]!.kind, undefined);
    assert.equal(lines.filter((line) => line.kind === undefined).length, 1);
    for (const [index, line] of lines.entries()) {
        assert.equal(index < terminalIndex, line.kind !== undefined, `line ${index} is on the wrong side of the view`);
    }
});

test("test_layer1_view_stream_reports_an_unresolvable_ref_as_a_terminal_error_line", async () => {
    // Scenario: the header is already written by the time readRepoTreeAtRef runs, so a bad ref
    // cannot be a 400 on this path the way it is on the plain one. It becomes a terminal error line
    // instead, and the page surfaces both through the same crumb.
    // Steps:
    // stream a request naming a ref that does not resolve.
    const lines = await readStreamLines({ dir: diskDir, repo: repoDir, ref: "no-such-ref" });
    const terminal = lines.at(-1)!;
    // the last line is an error line...
    assert.equal(terminal.kind, DocumentResponseKind.error);
    // ...whose label names the offending ref, so the crumb tells the user what to fix.
    assert.ok(terminal.label?.includes("no-such-ref"), terminal.label);
    // and no view was emitted alongside it.
    assert.equal(terminal.pairs, undefined);
});
