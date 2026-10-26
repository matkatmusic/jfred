import { test } from "node:test";
import assert from "node:assert/strict";
import { isScriptCodeWriteCapable } from "../src/reconstruction_script_prestate.ts";

test("test_isScriptCodeWriteCapable_accepts_a_read_only_analysis_script", () => {
    // Read-only analysis scripts must classify read-only so the sandbox is skipped (item 68).
    const script = 'import os\nimport re\nimport json\n'
        + 'text = open("ledger.py").read()\n'
        + 'hits = [line for line in text.splitlines() if re.search(r"def ", line)]\n'
        + 'print(json.dumps(len(hits)))\n';
    assert.equal(isScriptCodeWriteCapable(script), false);
});

test("test_isScriptCodeWriteCapable_flags_write_mode_opens", () => {
    // Literal "w"/"a" open modes are the classic write channel.
    assert.equal(isScriptCodeWriteCapable('open("out.txt", "w").write("x")\n'), true);
    assert.equal(isScriptCodeWriteCapable('open("log.txt", "a").write("x")\n'), true);
});

test("test_isScriptCodeWriteCapable_flags_an_unprovable_open_mode", () => {
    // Unparseable modes must fall to may-write: a false may-write is harmless, the reverse is not.
    assert.equal(isScriptCodeWriteCapable("open(p, mode)\n"), true);
    assert.equal(isScriptCodeWriteCapable("open(os.path.join(a, b))\n"), true);
});

test("test_isScriptCodeWriteCapable_accepts_read_mode_opens", () => {
    assert.equal(isScriptCodeWriteCapable('open("f.py", "r").read()\n'), false);
    assert.equal(isScriptCodeWriteCapable('open("f.py", "rb").read()\n'), false);
    assert.equal(isScriptCodeWriteCapable('open("f.py", encoding="utf-8").read()\n'), false);
});

test("test_isScriptCodeWriteCapable_flags_pathlib_and_os_write_methods", () => {
    // Path.open takes the mode as its FIRST argument.
    assert.equal(isScriptCodeWriteCapable('from pathlib import Path\nPath("f").write_text("x")\n'), true);
    assert.equal(isScriptCodeWriteCapable('from pathlib import Path\nPath("f").open("w")\n'), true);
    assert.equal(isScriptCodeWriteCapable('import os\nos.rename("a", "b")\n'), true);
    assert.equal(isScriptCodeWriteCapable('import os\nos.remove("a")\n'), true);
});

test("test_isScriptCodeWriteCapable_flags_unknown_and_escaping_imports", () => {
    // A non-allowlisted import may be a seeded local module that writes at top level (s34 family).
    assert.equal(isScriptCodeWriteCapable('import shutil\nshutil.move("a", "b")\n'), true);
    assert.equal(isScriptCodeWriteCapable("import apply_renames\n"), true);
    assert.equal(isScriptCodeWriteCapable('from os import remove\nremove("a")\n'), true);
    assert.equal(isScriptCodeWriteCapable("exec(compiled)\n"), true);
});

test("test_isScriptCodeWriteCapable_flags_shell_write_verbs", () => {
    // The python-only gate once labeled the s2 `mv` run read-only.
    assert.equal(isScriptCodeWriteCapable("mv /tmp/s2_original.py /tmp/s2_moved.py"), true);
    assert.equal(isScriptCodeWriteCapable("cp a.py b.py"), true);
    assert.equal(isScriptCodeWriteCapable("rm -f stale.txt"), true);
    assert.equal(isScriptCodeWriteCapable("mkdir -p out && touch out/marker"), true);
    assert.equal(isScriptCodeWriteCapable("cat notes.md | tee copy.md"), true);
    assert.equal(isScriptCodeWriteCapable("ln -s target link"), true);
    assert.equal(isScriptCodeWriteCapable("sed -i 's/a/b/' config.py"), true);
});

test("test_isScriptCodeWriteCapable_flags_shell_output_redirects_to_files", () => {
    // An output redirect whose target looks like a file path writes it.
    assert.equal(isScriptCodeWriteCapable("echo hello > out.txt"), true);
    assert.equal(isScriptCodeWriteCapable("python3 check.py >> logs/run.log"), true);
});

test("test_isScriptCodeWriteCapable_accepts_read_only_shell_probes", () => {
    // Harness probes and fd-dup / /dev/null redirects must stay read-only or the item-68 skip breaks.
    assert.equal(isScriptCodeWriteCapable("ls -la"), false);
    assert.equal(isScriptCodeWriteCapable("pytest -q tests/"), false);
    assert.equal(isScriptCodeWriteCapable("grep -n def ledger.py 2>&1"), false);
    assert.equal(isScriptCodeWriteCapable("pytest -q 2>/dev/null"), false);
    assert.equal(isScriptCodeWriteCapable("cat ledger.py | head -20"), false);
});
