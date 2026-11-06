// not behavior: every test here checks record counts and shapes of a test-only helper, not product behavior.
// import { test } from "node:test";
// import assert from "node:assert/strict";
// import { readFileSync } from "node:fs";
// import { join } from "node:path";
// import {
//     addScriptRun,
//     addWrite,
//     createCraftedProject,
//     writeCraftedSession,
//     writeProjectFile,
// } from "./layer1_run_test_helpers.ts";
//
// test("createCraftedProject starts with a folder and no records", () => {
//     const project = createCraftedProject();
//     assert.equal(project.records.length, 0);
//     assert.ok(project.dir.length > 0);
// });
//
// test("addWrite adds two records", () => {
//     const project = createCraftedProject();
//     addWrite(project, "toolu_w", 1, "a.txt", "a\n");
//     assert.equal(project.records.length, 2);
// });
//
// test("addScriptRun adds an error result only when isErrored is true", () => {
//     const project = createCraftedProject();
//     addScriptRun(project, "toolu_ok", 2, { code: "x" });
//     assert.equal(project.records.length, 1);
//     addScriptRun(project, "toolu_bad", 3, { code: "x" }, { isErrored: true });
//     assert.equal(project.records.length, 3);
// });
//
// test("writeProjectFile writes the content into the project folder", () => {
//     const project = createCraftedProject();
//     writeProjectFile(project, "b.txt", "hello\n");
//     assert.equal(readFileSync(join(project.dir, "b.txt"), "utf8"), "hello\n");
// });
//
// test("writeCraftedSession returns an input that points at the tool use", () => {
//     const project = createCraftedProject();
//     addWrite(project, "toolu_w", 1, "a.txt", "a\n");
//     const input = writeCraftedSession(project, "toolu_w");
//     assert.equal(input.toolUseId.toString(), "toolu_w");
//     assert.equal(input.sessionFiles.length, 1);
//     assert.equal(readFileSync(input.sessionFile.toString(), "utf8").split("\n").length, 3);
// });
