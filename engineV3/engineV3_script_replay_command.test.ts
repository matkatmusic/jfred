import { test } from "node:test";
import assert from "node:assert/strict";

import { ParsedCommandKind, parseInvokedCommand, type ParsedInvokedCommand } from "./engineV3_script_replay_command.ts";

const SCRIPT_PATH = "script.py";

function makeParsed(words: string[], settings: Record<string, string> = {}, workingFolder: string | null = null): ParsedInvokedCommand {
    return { kind: ParsedCommandKind.parsed, workingFolder, settings, words };
}

function getUnsupportedReason(result: ParsedInvokedCommand): string {
    assert.equal(result.kind, ParsedCommandKind.unsupported);
    if (result.kind === ParsedCommandKind.unsupported) {
        return result.reason;
    }
    throw new Error("the command line was parsed");
}

test("test_parseInvokedCommand_plain_words_follow_the_script", () => {
    // Steps:
    // parse a line with two plain words after the script.
    const result = parseInvokedCommand("python3 script.py word1 word2", SCRIPT_PATH);
    // both words come out, with no settings and no folder.
    assert.deepEqual(result, makeParsed(["word1", "word2"]));
});

test("test_parseInvokedCommand_quoted_words_with_spaces_stay_one_word", () => {
    // Steps:
    // parse a line with a double-quoted and a single-quoted word that hold spaces.
    const result = parseInvokedCommand("python3 script.py word1 \"word two\" 'word three'", SCRIPT_PATH);
    // each quoted part is one word, without quotes.
    assert.deepEqual(result, makeParsed(["word1", "word two", "word three"]));
});

test("test_parseInvokedCommand_settings_before_the_runner_are_split_at_equals", () => {
    // Steps:
    // parse a line with two settings before the runner, one quoted with a space.
    const result = parseInvokedCommand("NAME=value PYTHONPATH=\"/a b\" python3 script.py", SCRIPT_PATH);
    // both settings come out with quotes removed, and there are no words.
    assert.deepEqual(result, makeParsed([], { NAME: "value", PYTHONPATH: "/a b" }));
});

test("test_parseInvokedCommand_runner_given_by_full_path_is_accepted", () => {
    // Steps:
    // parse a line whose runner is a full path.
    const result = parseInvokedCommand("/opt/homebrew/bin/python3 script.py x", SCRIPT_PATH);
    // the word after the script comes out.
    assert.deepEqual(result, makeParsed(["x"]));
});

test("test_parseInvokedCommand_one_cd_gives_the_working_folder", () => {
    // Steps:
    // parse a line with one cd before the script.
    const result = parseInvokedCommand("cd sub && python3 script.py a", SCRIPT_PATH);
    // the folder is the cd target and the word comes out.
    assert.deepEqual(result, makeParsed(["a"], {}, "sub"));
});

test("test_parseInvokedCommand_two_cds_join_in_order", () => {
    // Steps:
    // parse a line with two relative cds, then one with an absolute second cd.
    const relativeResult = parseInvokedCommand("cd a && cd b && python3 script.py", SCRIPT_PATH);
    const absoluteResult = parseInvokedCommand("cd a && cd /x && python3 script.py", SCRIPT_PATH);
    // two relative folders are joined, an absolute folder replaces the earlier one.
    assert.deepEqual(relativeResult, makeParsed([], {}, "a/b"));
    assert.deepEqual(absoluteResult, makeParsed([], {}, "/x"));
});

test("test_parseInvokedCommand_unrelated_earlier_segment_is_ignored", () => {
    // Steps:
    // parse a line with a mkdir before the script.
    const result = parseInvokedCommand("mkdir o && python3 script.py a", SCRIPT_PATH);
    // the line is parsed, the word comes out, and the folder stays null.
    assert.deepEqual(result, makeParsed(["a"]));
});

test("test_parseInvokedCommand_earlier_segment_with_other_runner_is_skipped", () => {
    // Steps:
    // parse a line where an earlier segment names the script after cat.
    const result = parseInvokedCommand("cat script.py && python3 script.py a", SCRIPT_PATH);
    // the search goes on to the python3 segment.
    assert.deepEqual(result, makeParsed(["a"]));
});

test("test_parseInvokedCommand_later_segment_is_ignored", () => {
    // Steps:
    // parse a line with an echo after the script.
    const result = parseInvokedCommand("python3 script.py a && echo done", SCRIPT_PATH);
    // only the word of the script segment comes out.
    assert.deepEqual(result, makeParsed(["a"]));
});

test("test_parseInvokedCommand_dollar_words_are_unsupported", () => {
    // Steps:
    // parse five lines whose script words use a dollar sign.
    const settingThenVariable = parseInvokedCommand("X=5 python3 script.py $X", SCRIPT_PATH);
    const variable = parseInvokedCommand("python3 script.py $X", SCRIPT_PATH);
    const braces = parseInvokedCommand("python3 script.py ${X}", SCRIPT_PATH);
    const substitution = parseInvokedCommand("python3 script.py $(date)", SCRIPT_PATH);
    const substitutionWithCd = parseInvokedCommand("python3 script.py $(cd x && ls)", SCRIPT_PATH);
    // every line is unsupported, and the first four reasons hold a dollar sign.
    assert.match(getUnsupportedReason(settingThenVariable), /\$/);
    assert.match(getUnsupportedReason(variable), /\$/);
    assert.match(getUnsupportedReason(braces), /\$/);
    assert.match(getUnsupportedReason(substitution), /\$/);
    // the kind alone is asserted for the last line.
    assert.equal(substitutionWithCd.kind, ParsedCommandKind.unsupported);
});

test("test_parseInvokedCommand_setting_values_with_dollar_or_tilde_are_unsupported", () => {
    // Steps:
    // parse three lines with a setting value that the shell would expand.
    const dollarValue = parseInvokedCommand("NAME=$HOME/x python3 script.py", SCRIPT_PATH);
    const leadingTilde = parseInvokedCommand("PYTHONPATH=~/lib python3 script.py", SCRIPT_PATH);
    const tildeAfterColon = parseInvokedCommand("PYTHONPATH=/a:~/lib python3 script.py", SCRIPT_PATH);
    // each line is unsupported, and the first reason names the setting.
    assert.match(getUnsupportedReason(dollarValue), /NAME/);
    assert.equal(leadingTilde.kind, ParsedCommandKind.unsupported);
    assert.equal(tildeAfterColon.kind, ParsedCommandKind.unsupported);
});

test("test_parseInvokedCommand_tilde_inside_a_setting_value_is_plain_text", () => {
    // Steps:
    // parse a line whose setting value holds a tilde in the middle.
    const result = parseInvokedCommand("NAME=a~b python3 script.py", SCRIPT_PATH);
    // the line is parsed and the value keeps the tilde.
    assert.deepEqual(result, makeParsed([], { NAME: "a~b" }));
});

test("test_parseInvokedCommand_cd_to_home_or_dash_is_ignored", () => {
    // Steps:
    // parse a line with cd to a tilde path, and a line with cd to a dash.
    const tildeResult = parseInvokedCommand("cd ~/p && python3 script.py", SCRIPT_PATH);
    const dashResult = parseInvokedCommand("cd - && python3 script.py", SCRIPT_PATH);
    // both lines are parsed with a null folder.
    assert.deepEqual(tildeResult, makeParsed([]));
    assert.deepEqual(dashResult, makeParsed([]));
});

test("test_parseInvokedCommand_cd_inside_a_substitution_is_ignored", () => {
    // Steps:
    // parse a line where a mkdir holds a substitution with a cd.
    const result = parseInvokedCommand("mkdir $(cd x && pwd) && python3 script.py", SCRIPT_PATH);
    // the line is parsed and the folder stays null.
    assert.deepEqual(result, makeParsed([]));
});

test("test_parseInvokedCommand_pipe_ends_the_word_list", () => {
    // Steps:
    // parse a line with a pipe after the words.
    const result = parseInvokedCommand("python3 script.py a b | tail -5", SCRIPT_PATH);
    // only the words before the pipe come out.
    assert.deepEqual(result, makeParsed(["a", "b"]));
});

test("test_parseInvokedCommand_redirect_ends_the_word_list", () => {
    // Steps:
    // parse a line with redirects after the first word.
    const result = parseInvokedCommand("python3 script.py a > out.txt 2>&1", SCRIPT_PATH);
    // only the word before the redirect comes out.
    assert.deepEqual(result, makeParsed(["a"]));
});

test("test_parseInvokedCommand_exec_open_text_is_parsed_with_no_words", () => {
    // Steps:
    // parse Python text of an exec(open(...)) line with the script path x.py.
    const result = parseInvokedCommand("exec(open(\"x.py\").read())", "x.py");
    // the line is parsed with no words, no settings and no folder.
    assert.deepEqual(result, makeParsed([]));
});

test("test_parseInvokedCommand_cut_off_script_segment_is_unsupported", () => {
    // Steps:
    // parse a line whose script segment ends in an unclosed quote.
    const result = parseInvokedCommand("python3 script.py \"unclosed", SCRIPT_PATH);
    // the line is unsupported.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
});

test("test_parseInvokedCommand_path_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets PATH.
    const result = parseInvokedCommand("PATH=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
});

test("test_parseInvokedCommand_bash_env_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets BASH_ENV.
    const result = parseInvokedCommand("BASH_ENV=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
});

test("test_parseInvokedCommand_python_startup_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets PYTHONSTARTUP.
    const result = parseInvokedCommand("PYTHONSTARTUP=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
});

test("test_parseInvokedCommand_home_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets HOME.
    const result = parseInvokedCommand("HOME=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported, and the reason names HOME.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
    assert.ok(getUnsupportedReason(result).includes("HOME"));
});

test("test_parseInvokedCommand_tmpdir_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets TMPDIR.
    const result = parseInvokedCommand("TMPDIR=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported, and the reason names TMPDIR.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
    assert.ok(getUnsupportedReason(result).includes("TMPDIR"));
});

test("test_parseInvokedCommand_ld_preload_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets LD_PRELOAD.
    const result = parseInvokedCommand("LD_PRELOAD=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported, and the reason names LD_PRELOAD.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
    assert.ok(getUnsupportedReason(result).includes("LD_PRELOAD"));
});

test("test_parseInvokedCommand_ld_library_path_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets LD_LIBRARY_PATH.
    const result = parseInvokedCommand("LD_LIBRARY_PATH=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported, and the reason names LD_LIBRARY_PATH.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
    assert.ok(getUnsupportedReason(result).includes("LD_LIBRARY_PATH"));
});

test("test_parseInvokedCommand_pythonhome_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets PYTHONHOME.
    const result = parseInvokedCommand("PYTHONHOME=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported, and the reason names PYTHONHOME.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
    assert.ok(getUnsupportedReason(result).includes("PYTHONHOME"));
});

test("test_parseInvokedCommand_env_setting_is_unsupported", () => {
    // Steps:
    // parse a line that sets ENV.
    const result = parseInvokedCommand("ENV=/x python3 script.py", SCRIPT_PATH);
    // the line is unsupported, and the reason names ENV.
    assert.equal(result.kind, ParsedCommandKind.unsupported);
    assert.ok(getUnsupportedReason(result).includes("ENV"));
});

test("test_parseInvokedCommand_unchecked_text_in_a_later_segment_stays_parsed", () => {
    // Steps:
    // parse a line whose script segment comes first and a backtick comes in a later segment.
    const result = parseInvokedCommand("python3 script.py a; echo `date`", SCRIPT_PATH);
    // the line stays parsed with the one word.
    assert.deepEqual(result, makeParsed(["a"]));
});

test("test_parseInvokedCommand_empty_quoted_word_stays_a_word", () => {
    // Steps:
    // parse a line whose only word is an empty quoted string.
    const result = parseInvokedCommand("python3 script.py \"\"", SCRIPT_PATH);
    // the empty word comes out.
    assert.deepEqual(result, makeParsed([""]));
});
