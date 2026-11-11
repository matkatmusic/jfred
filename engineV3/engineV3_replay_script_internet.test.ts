import { test } from "node:test";
import assert from "node:assert/strict";

import { isInternetCommand, isReadOnlyCommand, isReadOnlyInternetCommand } from "./engineV3_replay_script_internet.ts";

test("test_isReadOnlyInternetCommand_is_true_for_a_dig_lookup", () => {
  // Scenario: dig asks a name server on the internet and writes no file.
  // the command is skipped
  assert.equal(isReadOnlyInternetCommand("dig +short example.com"), true);
});

test("test_isReadOnlyInternetCommand_is_false_for_a_curl_to_localhost", () => {
  // Scenario: a stand-in listener in the container answers localhost.
  // the command is not an internet command, so it is not skipped
  assert.equal(isReadOnlyInternetCommand("curl -s localhost:3000/x"), false);
});

test("test_isReadOnlyInternetCommand_is_false_for_a_curl_that_saves_to_a_file_with_o", () => {
  // Scenario: curl -o writes the download into a file.
  // the command changes a file, so it is not skipped
  assert.equal(isReadOnlyInternetCommand("curl -o /tmp/x https://example.com/x"), false);
});

test("test_isReadOnlyInternetCommand_is_false_for_a_curl_that_redirects_into_a_file", () => {
  // Scenario: a > redirect writes the download into a file.
  // the command changes a file, so it is not skipped
  assert.equal(isReadOnlyInternetCommand("curl https://example.com > out.txt"), false);
});

test("test_isReadOnlyInternetCommand_is_false_for_a_curl_that_redirects_into_a_variable_path", () => {
  // Scenario: a redirect target that starts with a variable is still a file.
  // the command changes a file, so it is not skipped
  assert.equal(isReadOnlyInternetCommand("curl -s https://example.com > $S/a.html"), false);
});

test("test_isReadOnlyInternetCommand_is_true_for_reads_that_throw_away_stderr_and_then_dig", () => {
  // Scenario: 2>/dev/null and a pipe into head change no file.
  // the command is skipped
  assert.equal(isReadOnlyInternetCommand("rg foo file 2>/dev/null | head; dig +short a.example.com"), true);
});

test("test_isReadOnlyInternetCommand_is_true_for_a_curl_that_joins_stderr_and_pipes_into_head", () => {
  // Scenario: 2>&1 copies a stream and writes no file.
  // the command is skipped
  assert.equal(isReadOnlyInternetCommand("curl -sS https://example.com/x 2>&1 | head -5"), true);
});

test("test_isReadOnlyInternetCommand_is_true_for_a_curl_that_throws_the_body_away_with_o_dev_null", () => {
  // Scenario: -o /dev/null writes no file.
  // the command is skipped
  assert.equal(isReadOnlyInternetCommand('curl -s -o /dev/null -w "%{http_code}" https://example.com/'), true);
});

test("test_isReadOnlyInternetCommand_is_false_for_a_curl_with_remote_name_in_a_flag_group", () => {
  // Scenario: -fsSLO saves the download under its own name.
  // the command changes a file, so it is not skipped
  assert.equal(isReadOnlyInternetCommand("curl -fsSLO https://example.com/x.tar.gz"), false);
});

test("test_isReadOnlyInternetCommand_is_false_for_a_curl_o_after_a_line_continuation", () => {
  // Scenario: a backslash at the end of a line joins the next line, so -o is still a flag.
  // the command changes a file, so it is not skipped
  assert.equal(isReadOnlyInternetCommand("curl -s \\\n-o out.html https://example.com/x"), false);
});

test("test_isReadOnlyInternetCommand_is_false_when_a_command_substitution_hides_a_command", () => {
  // Scenario: the command inside $( ) cannot be checked, so it counts as changing files.
  // the command is not skipped
  assert.equal(isReadOnlyInternetCommand("curl -s https://example.com/$(date +%s)"), false);
});

test("test_isReadOnlyInternetCommand_is_false_for_a_heredoc", () => {
  // Scenario: a heredoc feeds code to a program that cannot be checked.
  // the command is not skipped
  assert.equal(isReadOnlyInternetCommand("dig +short a.example.com; python3 - <<'E'\nprint(1)\nE"), false);
});

test("test_isReadOnlyInternetCommand_is_false_for_an_unknown_program", () => {
  // Scenario: a program that is not on the read-only list counts as changing files.
  // the command is not skipped
  assert.equal(isReadOnlyInternetCommand("dig +short a.example.com; bun x.ts"), false);
});

test("test_isReadOnlyInternetCommand_is_false_for_tee", () => {
  // Scenario: tee writes its input into a file.
  // the command is not skipped
  assert.equal(isReadOnlyInternetCommand("dig +short a.example.com | tee out.txt"), false);
});

test("test_isReadOnlyInternetCommand_is_false_for_a_quote_that_is_never_closed", () => {
  // Scenario: zsh rejects a quote that is never closed, so the command must run to give its recorded error.
  // the command is not skipped
  assert.equal(isReadOnlyInternetCommand("dig +short a.example.com; jq '.a' \"x"), false);
});

test("test_isReadOnlyCommand_ignores_a_redirect_sign_inside_quotes", () => {
  // Scenario: a > inside quotes is text, not a redirect.
  // the command writes no file
  assert.equal(isReadOnlyCommand("rg -n 'a > b' file.txt"), true);
});

test("test_isInternetCommand_is_false_for_a_program_name_inside_quotes", () => {
  // Scenario: rg searching for the word ssh does not run ssh.
  // the command needs no internet
  assert.equal(isInternetCommand('rg -i "tunnel|ssh|vps" tunnel.sh'), false);
});

// Real Attune Bash calls that need the internet and change no file.
const REAL_READ_ONLY_INTERNET_COMMANDS = [
  "rg -il 'matkatmusic\\.com' ~/.ssh/config ~/Programming/dotfiles ~/Programming/\"Live chordiephpauthv3\" 2>/dev/null | head; rg -i -A3 'matkat' ~/.ssh/config 2>/dev/null | head -20; dig +short attune.matkatmusic.com matkatmusic.com",
  "curl -sS -I https://attune.matkatmusic.com/definitions | head -4",
  "ssh new-bluehost-vps 'ss -ltn | grep 3100 || echo \"port 3100 free\"'",
  "curl -s https://docs.typesafe.ai/api.md | rg -i -n \"limit|maximum|max |questions per|too many\" | head -20",
  "curl -sL -A \"Mozilla/5.0\" \"https://en.wiktionary.org/w/index.php?title=patronize&action=raw\" | rg -n '^# ' | cut -c1-220",
];

// Real Attune Bash calls that need the internet and change files, so they run with the network.
const REAL_WRITING_INTERNET_COMMANDS = [
  "cd /private/tmp/claude-501/-Users-matkatmusicllc-Programming-Attune/81018f89-bcab-4d7f-b85d-9691bf4462cc/scratchpad && mkdir -p tools && cd tools && bun add linkedom 2>&1 | tail -3",
  "cd /private/tmp/claude-501/-Users-matkatmusicllc-Programming-Attune/cf71c24f-2f4a-4ac9-af79-46f59557b324/scratchpad && for q in adorability agitations affectionless; do curl -s -o \"cam-$q.html\" -w \"$q %{http_code} %{size_download} %{redirect_url}\\n\" -A \"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15\" \"https://dictionary.cambridge.org/us/spellcheck/english/?q=$q\"; done; rg -c \"Search suggestions for\" cam-*.html",
  "cd ~/Programming/wheels && git fetch -q && git log --oneline -3 develop && git status -sb | head -3 && git ls-remote origin | head; rg -n -i 'message|surround|context' README.md | head -20; ls",
  "set -a && . ./.env && set +a && curl -s --max-time 20 \"https://www.dictionaryapi.com/api/v3/references/collegiate/json/startling?key=$MERRIAM_WEBSTER_DICTIONARY_KEY\" | head -c 4000",
];

for (const command of REAL_READ_ONLY_INTERNET_COMMANDS) {
  test(`test_isReadOnlyInternetCommand_is_true_for_the_real_call: ${command.slice(0, 60)}`, () => {
    // Scenario: a real read-only internet call from the Attune Bash calls is skipped.
    assert.equal(isReadOnlyInternetCommand(command), true);
  });
}

for (const command of REAL_WRITING_INTERNET_COMMANDS) {
  test(`test_isReadOnlyInternetCommand_is_false_for_the_real_call: ${command.slice(0, 60)}`, () => {
    // Scenario: a real internet call that changes files is not skipped.
    // the call needs the internet
    assert.equal(isInternetCommand(command), true);
    // the call is not skipped
    assert.equal(isReadOnlyInternetCommand(command), false);
  });
}

test("test_isInternetCommand_is_true_for_ssh_to_another_machine", () => {
  // Scenario: ssh reaches another machine.
  // the command needs the internet
  assert.equal(isInternetCommand("ssh new-bluehost-vps 'uptime'"), true);
});
