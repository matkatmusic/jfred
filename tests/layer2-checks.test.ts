// Retired: the pure-helper tests moved to tests/layer2-payload.test.ts when the helpers moved to layer2-payload.ts.
// import { strict as assert } from "node:assert";
// import { test } from "node:test";
// import { collectOwnerBasenames, countExpectedSnapshots, type ViewPayload } from "../scripts/visual/layer2-payload.ts";
//
// const snapshot = (sessionFile: string) => ({ version: 1, sessionId: "s", sessionFile });
//
// const PAYLOAD: ViewPayload = {
//     pairs: [
//         { path: "a.ts", snapshots: [snapshot("/x/one.jsonl"), snapshot("/x/two.jsonl")] },
//         { path: "b.ts" },
//         { path: "c.ts", snapshots: [snapshot("/y/one.jsonl")] },
//     ],
//     diskOrphans: [{ snapshots: [snapshot("three.jsonl")] }, {}],
// };
//
// test("countExpectedSnapshots sums pair snapshots and orphan snapshots", () => {
//     assert.equal(countExpectedSnapshots(PAYLOAD), 4);
// });
//
// test("countExpectedSnapshots is zero for an empty payload", () => {
//     assert.equal(countExpectedSnapshots({ pairs: [], diskOrphans: [] }), 0);
// });
//
// test("collectOwnerBasenames keeps the file names of pair snapshots, once each", () => {
//     assert.deepEqual([...collectOwnerBasenames(PAYLOAD)].sort(), ["one.jsonl", "two.jsonl"]);
// });
