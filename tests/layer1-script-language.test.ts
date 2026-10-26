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

test("only python, shell, bash, javascript and typescript map to a highlight language", () => {
    const mapped = Object.values(WireScriptLanguage).map((language) => [language, computeScriptHighlightLanguage(language)]);
    assert.deepEqual(mapped.filter(([, highlight]) => highlight !== undefined), [
        ["javascript", "javascript"], ["typescript", "typescript"], ["python", "python"], ["shell", "bash"], ["bash", "bash"],
    ]);
});

test("parseScriptLanguage accepts every ctx_execute language and throws on an unknown one", () => {
    for (const language of Object.values(WireScriptLanguage)) {
        assert.equal(parseScriptLanguage(language), language);
    }
    assert.throws(() => parseScriptLanguage("cobol"), /unknown script language: cobol/);
});
