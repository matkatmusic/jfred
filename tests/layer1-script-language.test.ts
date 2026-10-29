// The script language vocabulary: one label source, the highlight mapping, and the parser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireScriptLanguage, computeScriptHighlightLanguage, describeScriptLanguage, parseScriptLanguage } from "../webapp/layer1-script-language.ts";

test("every language, the Bash tool included, reads '<language> run'", () => {
    for (const language of Object.values(WireScriptLanguage)) {
        assert.equal(describeScriptLanguage(language), `${language} run`);
    }
    assert.equal(describeScriptLanguage(WireScriptLanguage.bash), "bash run");
    assert.equal(describeScriptLanguage(WireScriptLanguage.shell), "shell run");
    assert.equal(describeScriptLanguage(WireScriptLanguage.typescript), "typescript run");
});

test("only python, python3, shell, bash, javascript, node, typescript and html map to a highlight language", () => {
    const mapped = Object.values(WireScriptLanguage).map((language) => [language, computeScriptHighlightLanguage(language)]);
    assert.deepEqual(mapped.filter(([, highlight]) => highlight !== undefined), [
        ["javascript", "javascript"], ["node", "javascript"], ["typescript", "typescript"], ["python", "python"], ["python3", "python"], ["shell", "bash"], ["bash", "bash"], ["html", "xml"],
    ]);
});

test("python3 and html parse to their members, read '<language> run' and highlight as python and xml", () => {
    const python3 = parseScriptLanguage("python3");
    assert.equal(python3, WireScriptLanguage.python3);
    assert.equal(describeScriptLanguage(python3), "python3 run");
    assert.equal(computeScriptHighlightLanguage(python3), "python");
    const html = parseScriptLanguage("html");
    assert.equal(html, WireScriptLanguage.html);
    assert.equal(describeScriptLanguage(html), "html run");
    assert.equal(computeScriptHighlightLanguage(html), "xml");
});

test("node parses to the node member, reads 'node run' and highlights as javascript", () => {
    const language = parseScriptLanguage("node");
    assert.equal(language, WireScriptLanguage.node);
    assert.equal(describeScriptLanguage(language), "node run");
    assert.equal(computeScriptHighlightLanguage(language), "javascript");
});

test("parseScriptLanguage accepts every ctx_execute language and throws on an unknown one", () => {
    for (const language of Object.values(WireScriptLanguage)) {
        assert.equal(parseScriptLanguage(language), language);
    }
    assert.throws(() => parseScriptLanguage("cobol"), /unknown script language: cobol/);
});
