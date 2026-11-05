import { test } from "node:test";
import assert from "node:assert/strict";
import { convertSpecifier, replaceFileSpecifiers, type MoveMap } from "../scripts/rewrite_layer1_imports.ts";

// Made-up stems, so a real codemod run never rewrites this file.
const MOVES: MoveMap = new Map([
  ["webapp/layer1-alpha.ts", "webapp/layer1-components/one/layer1-alpha.ts"],
  ["webapp/layer1-beta.ts", "webapp/layer1-components/one/layer1-beta.ts"],
  ["webapp/layer1-gamma.ts", "webapp/layer1-components/two/layer1-gamma.ts"],
]);
const ALPHA_OLD = ["webapp", "layer1-alpha.ts"].join("/");
const ALPHA_NEW = "webapp/layer1-components/one/layer1-alpha.ts";
const isAlwaysPresent = (_path: string): boolean => true;
const isNeverPresent = (_path: string): boolean => false;

test("test_convertSpecifier_points_a_staying_file_at_a_moved_file", () => {
  // Scenario: webapp/layer1-page.ts stays and imports the moved alpha file.
  const specifier = convertSpecifier("./layer1-alpha.ts", "webapp/layer1-page.ts", "webapp/layer1-page.ts", MOVES, isNeverPresent);
  assert.equal(specifier, "./layer1-components/one/layer1-alpha.ts");
});

test("test_convertSpecifier_points_a_test_at_a_moved_file", () => {
  // Scenario: a test imports the moved alpha file from tests/.
  const specifier = convertSpecifier("../webapp/layer1-alpha.ts", "tests/a.test.ts", "tests/a.test.ts", MOVES, isNeverPresent);
  assert.equal(specifier, "../webapp/layer1-components/one/layer1-alpha.ts");
});

test("test_convertSpecifier_points_a_moved_file_at_a_staying_file", () => {
  // Scenario: the moved alpha file imports webapp/layer1-wire.ts, which stays.
  const specifier = convertSpecifier("./layer1-wire.ts", ALPHA_OLD, ALPHA_NEW, MOVES, isAlwaysPresent);
  assert.equal(specifier, "../../layer1-wire.ts");
});

test("test_convertSpecifier_keeps_a_sibling_in_the_same_component", () => {
  // Scenario: alpha imports beta, and both moved into component one.
  const specifier = convertSpecifier("./layer1-beta.ts", ALPHA_OLD, ALPHA_NEW, MOVES, isNeverPresent);
  assert.equal(specifier, "./layer1-beta.ts");
});

test("test_convertSpecifier_points_a_moved_file_at_another_component", () => {
  // Scenario: alpha imports gamma, which moved into component two.
  const specifier = convertSpecifier("./layer1-gamma.ts", ALPHA_OLD, ALPHA_NEW, MOVES, isNeverPresent);
  assert.equal(specifier, "../two/layer1-gamma.ts");
});

test("test_convertSpecifier_leaves_a_missing_relative_target", () => {
  // Scenario: a moved file holds a relative string that names no file.
  const specifier = convertSpecifier("./not-a-file", ALPHA_OLD, ALPHA_NEW, MOVES, isNeverPresent);
  assert.equal(specifier, "./not-a-file");
});

test("test_convertSpecifier_converts_a_dist_url_and_keeps_js", () => {
  // Scenario: a browser expression imports the compiled alpha file by its /app/ URL.
  const specifier = convertSpecifier("/app/layer1-alpha.js", "scripts/visual/x.ts", "scripts/visual/x.ts", MOVES, isNeverPresent);
  assert.equal(specifier, "/app/layer1-components/one/layer1-alpha.js");
});

test("test_convertSpecifier_converts_a_root_relative_source_path", () => {
  // Scenario: a test reads the alpha source by its repo path.
  const specifier = convertSpecifier(ALPHA_OLD, "tests/a.test.ts", "tests/a.test.ts", MOVES, isNeverPresent);
  assert.equal(specifier, ALPHA_NEW);
});

test("test_convertSpecifier_leaves_an_api_route", () => {
  // Scenario: /api/layer1-alpha is a server route, not a file.
  const specifier = convertSpecifier("/api/layer1-alpha", "tests/a.test.ts", "tests/a.test.ts", MOVES, isNeverPresent);
  assert.equal(specifier, "/api/layer1-alpha");
});

test("test_replaceFileSpecifiers_converts_import_export_and_dynamic_import", () => {
  // Scenario: one file uses all three specifier forms plus a template-literal browser import.
  const text = [
    "import { a } from \"./layer1-alpha.ts\";",
    "export { b } from './layer1-gamma.ts';",
    "const c = await import(\"./layer1-alpha.ts\");",
    "const d = `import('/app/layer1-alpha.js')`;",
  ].join("\n");
  const rewrittenText = replaceFileSpecifiers(text, "webapp/layer1-page.ts", "webapp/layer1-page.ts", MOVES, isNeverPresent);
  assert.equal(rewrittenText, [
    "import { a } from \"./layer1-components/one/layer1-alpha.ts\";",
    "export { b } from './layer1-components/two/layer1-gamma.ts';",
    "const c = await import(\"./layer1-components/one/layer1-alpha.ts\");",
    "const d = `import('/app/layer1-components/one/layer1-alpha.js')`;",
  ].join("\n"));
});
