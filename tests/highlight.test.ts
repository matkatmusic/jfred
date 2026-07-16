import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLanguageForPath } from "../webapp/highlight.ts";

test("computeLanguageForPath maps a .py path to python", () => {
    assert.equal(computeLanguageForPath("a/b/orders.py"), "python");
});

test("computeLanguageForPath folds extension case (.TS -> typescript)", () => {
    assert.equal(computeLanguageForPath("X.TS"), "typescript");
});

test("computeLanguageForPath returns undefined for an extensionless name", () => {
    assert.equal(computeLanguageForPath("Makefile"), undefined);
});

test("computeLanguageForPath returns undefined for a leading-dot name", () => {
    assert.equal(computeLanguageForPath(".gitignore"), undefined);
});

test("computeLanguageForPath returns undefined for an unknown extension", () => {
    assert.equal(computeLanguageForPath("notes.txt"), undefined);
});

