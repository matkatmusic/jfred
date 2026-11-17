import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCommandLineAtJoiners } from "../src/reconstruction_bash_split.ts";

test("test_splits_two_rm_commands_at_a_double_ampersand", () => {
    // Split a line of two rm commands joined by &&.
    const pieces = splitCommandLineAtJoiners("rm a.py && rm b.py");
    // Each rm command is its own piece.
    assert.deepEqual(pieces, ["rm a.py", "rm b.py"]);
});

test("test_splits_a_first_command_that_is_not_rm_from_the_rm_after_it", () => {
    // Split a line of ls then rm joined by &&.
    const pieces = splitCommandLineAtJoiners("ls && rm a.py");
    // The ls and the rm are separate pieces.
    assert.deepEqual(pieces, ["ls", "rm a.py"]);
});

test("test_splits_two_mv_commands_at_a_double_ampersand", () => {
    // Split a line of two mv commands joined by &&.
    const pieces = splitCommandLineAtJoiners("mv a b && mv c d");
    // Each mv command is its own piece.
    assert.deepEqual(pieces, ["mv a b", "mv c d"]);
});

test("test_splits_cp_and_rm_at_a_semicolon", () => {
    // Split a line of cp then rm joined by a semicolon.
    const pieces = splitCommandLineAtJoiners("cp a b; rm a");
    // The cp and the rm are separate pieces.
    assert.deepEqual(pieces, ["cp a b", "rm a"]);
});

test("test_splits_two_rm_commands_on_two_lines", () => {
    // Split two rm commands separated by a newline.
    const pieces = splitCommandLineAtJoiners("rm a\nrm b");
    // Each line is its own piece.
    assert.deepEqual(pieces, ["rm a", "rm b"]);
});

test("test_splits_a_redirect_from_the_command_after_it", () => {
    // Split a redirect command from the ls after it.
    const pieces = splitCommandLineAtJoiners("echo x > f && ls");
    // The redirect stays in the first piece.
    assert.deepEqual(pieces, ["echo x > f", "ls"]);
});

test("test_splits_at_a_double_pipe", () => {
    // Split rm from the echo after a double pipe.
    const pieces = splitCommandLineAtJoiners("rm a.py || echo failed");
    // The rm and the echo are separate pieces.
    assert.deepEqual(pieces, ["rm a.py", "echo failed"]);
});

test("test_splits_at_a_single_pipe", () => {
    // Split rm from the grep after a single pipe.
    const pieces = splitCommandLineAtJoiners("rm a.py | grep x");
    // The rm and the grep are separate pieces.
    assert.deepEqual(pieces, ["rm a.py", "grep x"]);
});

test("test_does_not_split_at_a_joiner_inside_double_quotes", () => {
    // Split a line whose && is inside double quotes.
    const pieces = splitCommandLineAtJoiners('echo "a && b" > out.txt');
    // The line stays one piece.
    assert.deepEqual(pieces, ['echo "a && b" > out.txt']);
});

test("test_does_not_split_at_a_joiner_inside_single_quotes", () => {
    // Split a line whose semicolon is inside single quotes.
    const pieces = splitCommandLineAtJoiners("git commit -m 'x; y'");
    // The line stays one piece.
    assert.deepEqual(pieces, ["git commit -m 'x; y'"]);
});

test("test_does_not_split_at_a_semicolon_inside_double_quotes", () => {
    // Split a line whose semicolon is inside double quotes.
    const pieces = splitCommandLineAtJoiners('git commit -m "x; y"');
    // The line stays one piece.
    assert.deepEqual(pieces, ['git commit -m "x; y"']);
});

test("test_does_not_split_at_a_single_ampersand", () => {
    // Split a line that holds 2>&1 and a pipe.
    const pieces = splitCommandLineAtJoiners("python3 x.py 2>&1 | tail -10");
    // The 2>&1 stays inside the first piece.
    assert.deepEqual(pieces, ["python3 x.py 2>&1", "tail -10"]);
});

test("test_keeps_a_line_with_a_heredoc_as_one_piece", () => {
    // Split a line that holds a heredoc.
    const commandLine = "cat > f.txt <<'EOF'\nrm z\nEOF";
    const pieces = splitCommandLineAtJoiners(commandLine);
    // The whole line stays one piece.
    assert.deepEqual(pieces, [commandLine]);
});

test("test_keeps_a_line_with_a_subshell_paren_as_one_piece", () => {
    // Split a line that holds a subshell.
    const pieces = splitCommandLineAtJoiners("(rm a; rm b)");
    // The whole line stays one piece.
    assert.deepEqual(pieces, ["(rm a; rm b)"]);
});

test("test_keeps_a_line_with_a_dollar_paren_as_one_piece", () => {
    // Split a line that holds a dollar-paren substitution.
    const pieces = splitCommandLineAtJoiners("echo $(rm a; rm b) && ls");
    // The whole line stays one piece.
    assert.deepEqual(pieces, ["echo $(rm a; rm b) && ls"]);
});

test("test_keeps_a_line_with_a_backtick_as_one_piece", () => {
    // Split a line that holds a backtick substitution.
    const pieces = splitCommandLineAtJoiners("echo `date` && rm a");
    // The whole line stays one piece.
    assert.deepEqual(pieces, ["echo `date` && rm a"]);
});

test("test_splits_a_paren_inside_double_quotes", () => {
    // Split a line whose paren is inside double quotes.
    const pieces = splitCommandLineAtJoiners('echo "(a)" && rm x');
    // The quoted paren does not stop the split.
    assert.deepEqual(pieces, ['echo "(a)"', "rm x"]);
});

test("test_gives_one_piece_for_a_line_without_a_joiner", () => {
    // Split a line with no joiner and spaces around it.
    const pieces = splitCommandLineAtJoiners("  rm a.py  ");
    // The piece is trimmed.
    assert.deepEqual(pieces, ["rm a.py"]);
});

test("test_gives_no_piece_for_an_empty_line", () => {
    // Split an empty line.
    const pieces = splitCommandLineAtJoiners("");
    // There are no pieces.
    assert.deepEqual(pieces, []);
});

test("test_splits_a_double_ampersand_after_rm_with_a_flag_and_a_redirect_word", () => {
    // Split an rm -rf line from a git line that ends in a redirect.
    const pieces = splitCommandLineAtJoiners("rm -rf /tmp/plate-live.bWFRfk/.plate && git -C /tmp/plate-live.bWFRfk checkout -- .gitignore 2>/dev/null");
    // The two commands are separate pieces.
    assert.deepEqual(pieces, ["rm -rf /tmp/plate-live.bWFRfk/.plate", "git -C /tmp/plate-live.bWFRfk checkout -- .gitignore 2>/dev/null"]);
});

test("test_splits_rm_then_ls_then_echo", () => {
    // Split a line of rm, ls and echo joined by && and a semicolon.
    const pieces = splitCommandLineAtJoiners("rm /tmp/migrate-nnn-to-timestamp.py && ls /tmp/migrate-nnn-to-timestamp.py 2>&1; echo done");
    // The three commands are separate pieces.
    assert.deepEqual(pieces, ["rm /tmp/migrate-nnn-to-timestamp.py", "ls /tmp/migrate-nnn-to-timestamp.py 2>&1", "echo done"]);
});

test("test_splits_a_semicolon_right_after_a_path", () => {
    // Split rm from echo at a semicolon that follows a path.
    const pieces = splitCommandLineAtJoiners("rm a.py; echo done");
    // The rm and the echo are separate pieces.
    assert.deepEqual(pieces, ["rm a.py", "echo done"]);
});
