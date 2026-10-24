// A ctx_execute run's input `language` is captured; only shell-language runs leave the python executor kind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptExecutorKind, findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

const T1 = "2026-01-01T00:00:01Z";
const T2 = "2026-01-01T00:00:02Z";

test("a ctx_execute shell run is a bash run that keeps its language", () => {
    const [run] = findScriptExecutionRuns([buildToolRecord(ToolName.CtxExecute, { language: "shell", code: "ls" }, T1)]);
    assert.equal(run!.executorKind, ScriptExecutorKind.bash);
    assert.equal(run!.language, "shell");
});

test("a ctx_execute bash-language run is a bash run", () => {
    const [run] = findScriptExecutionRuns([buildToolRecord(ToolName.CtxExecute, { language: "bash", code: "ls" }, T1)]);
    assert.equal(run!.executorKind, ScriptExecutorKind.bash);
});

test("every other ctx_execute language stays python and keeps its language", () => {
    for (const language of ["python", "javascript", "typescript", "ruby"]) {
        const [run] = findScriptExecutionRuns([buildToolRecord(ToolName.CtxExecute, { language, code: "x" }, T1)]);
        assert.equal(run!.executorKind, ScriptExecutorKind.python, language);
        assert.equal(run!.language, language);
    }
});

test("ctx_execute_file reads its language too", () => {
    const [run] = findScriptExecutionRuns([buildToolRecord(ToolName.CtxExecuteFile, { language: "shell", code: "ls" }, T1)]);
    assert.equal(run!.language, "shell");
    assert.equal(run!.executorKind, ScriptExecutorKind.bash);
});

test("a Bash run has no language key at all", () => {
    const [run] = findScriptExecutionRuns([buildToolRecord(ToolName.Bash, { command: "ls" }, T1)]);
    assert.equal(run!.executorKind, ScriptExecutorKind.bash);
    assert.equal("language" in run!, false);
});

test("a ctx_execute run without a language has no language key and stays python", () => {
    const [run] = findScriptExecutionRuns([buildToolRecord(ToolName.CtxExecute, { code: "print(1)" }, T1)]);
    assert.equal(run!.executorKind, ScriptExecutorKind.python);
    assert.equal("language" in run!, false);
});

test("indirection to a written .py file turns a Bash run into a python-language run", () => {
    const body = "print(1)\n";
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/apply.py", content: body }, T1),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, T2),
    ];
    const resolved = findScriptExecutionRuns(records).find((run) => run.code === body);
    assert.equal(resolved!.executorKind, ScriptExecutorKind.python);
    assert.equal(resolved!.language, "python");
});

test("indirection to a written .py file also rewrites a shell-language ctx run to python", () => {
    const body = "print(1)\n";
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/apply.py", content: body }, T1),
        buildToolRecord(ToolName.CtxExecute, { language: "shell", code: "python3 apply.py" }, T2),
    ];
    const resolved = findScriptExecutionRuns(records).find((run) => run.code === body);
    assert.equal(resolved!.executorKind, ScriptExecutorKind.python);
    assert.equal(resolved!.language, "python");
});

test("indirection to a non-python file keeps the run's own language", () => {
    const body = "echo hi\n";
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/hook.sh", content: body }, T1),
        buildToolRecord(ToolName.CtxExecute, { language: "shell", code: "bash hook.sh" }, T2),
    ];
    const resolved = findScriptExecutionRuns(records).find((run) => run.code === body);
    assert.equal(resolved!.executorKind, ScriptExecutorKind.bash);
    assert.equal(resolved!.language, "shell");
});
