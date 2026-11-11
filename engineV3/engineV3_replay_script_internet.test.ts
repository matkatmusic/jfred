import { test } from "node:test";
import assert from "node:assert/strict";

import { isInternetCommand, isReadOnlyCommand, isReadOnlyInternetCommand, isReadOnlyMacStateCommand } from "./engineV3_replay_script_internet.ts";

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

for (const command of ["curl -sLoout.html https://example.com/x", "curl -o\"$S/a.html\" https://example.com/x", "curl -o/tmp/x https://example.com/x"]) {
  test(`test_isReadOnlyInternetCommand_is_false_for_a_curl_o_with_the_file_joined_to_the_flag: ${command}`, () => {
    // Scenario: curl -o with its file in the same word still writes the file.
    // the command changes a file, so it is not skipped
    assert.equal(isReadOnlyInternetCommand(command), false);
  });
}

test("test_isReadOnlyInternetCommand_is_true_for_a_curl_o_dev_null_joined_to_the_flag", () => {
  // Scenario: -o/dev/null writes no file.
  // the command is skipped
  assert.equal(isReadOnlyInternetCommand("curl -s -o/dev/null https://example.com/x"), true);
});

for (const command of ["curl -s https://example.com >& out.txt", "curl -s https://example.com >&out.txt"]) {
  test(`test_isReadOnlyInternetCommand_is_false_for_a_zsh_redirect_of_both_streams_into_a_file: ${command}`, () => {
    // Scenario: in zsh >& file writes both streams into the file.
    // the command changes a file, so it is not skipped
    assert.equal(isReadOnlyInternetCommand(command), false);
  });
}

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

test("test_isReadOnlyCommand_looks_at_the_commands_inside_a_command_substitution", () => {
  // Scenario: the command inside $( ) only reads, so the whole command writes no file.
  assert.equal(isReadOnlyCommand("d=$(rg -n x file.txt | head -1); echo \"$d\""), true);
});

test("test_isReadOnlyCommand_is_false_when_a_command_substitution_writes_a_file", () => {
  // Scenario: the command inside $( ) writes a file.
  assert.equal(isReadOnlyCommand("echo $(rg x file.txt > out.txt)"), false);
});

test("test_isReadOnlyCommand_is_false_for_a_command_substitution_that_is_never_closed", () => {
  // Scenario: zsh rejects a $( ) that is never closed, so the command must run to give its recorded error.
  assert.equal(isReadOnlyCommand("echo $(rg x file.txt"), false);
});

const READ_ONLY_TEXT_COMMANDS = [
  "ps aux | sort -rn | uniq -c",
  "ps aux | awk '{print $2, $9}'",
  "ps aux | awk '$1>150'",
  "ps aux | sed -n 1,5p",
  "ps aux | sed 's/.*sessions\\///; s/\\.json//'",
  "ps aux | tr '\\n' ','",
  "for f in a b; do [ -n \"$f\" ] && break; done",
];

const WRITING_TEXT_COMMANDS = [
  "ps aux | sort -o out.txt",
  "ps aux | uniq - out.txt",
  "ps aux | awk '{print $2 > \"out.txt\"}'",
  "ps aux | awk '{system(\"touch x\")}'",
  "sed -i '' 's/a/b/' file.txt",
  "sed -i.bak 's/a/b/' file.txt",
  "ps aux | sed -n '1,5w out.txt'",
  "sed -Ei 's/a/b/' file.txt",
  "sed -ni 's/a/b/p' file.txt",
  "ps aux | sed -f script.sed",
  "ps aux | sed --file=script.sed",
];

for (const command of READ_ONLY_TEXT_COMMANDS) {
  test(`test_isReadOnlyCommand_is_true_for_a_text_program_that_writes_no_file: ${command}`, () => {
    // Scenario: sort, uniq, awk, sed, tr and [ only print, so the command writes no file.
    assert.equal(isReadOnlyCommand(command), true);
  });
}

for (const command of WRITING_TEXT_COMMANDS) {
  test(`test_isReadOnlyCommand_is_false_for_a_text_program_that_writes_a_file: ${command}`, () => {
    // Scenario: the flag or the program text makes the program write a file or run a command.
    assert.equal(isReadOnlyCommand(command), false);
  });
}

// Commands that only look at Mac programs or Mac machine state, and change no file: the replay skips them (user decision 9).
const SKIPPED_MAC_STATE_COMMANDS = [
  "for p in $(pgrep -x claude); do d=$(lsof -a -p $p -d cwd -Fn 2>/dev/null | rg '^n' | cut -c2-); echo \"$p $d\"; done | rg harms",
  "pgrep -x claude | wc -l",
  "pkill -f vite; sleep 1",
  "tmux ls",
  // Real Attune Bash calls.
  "lsof -nP -iTCP:3000 -sTCP:LISTEN; for p in $(lsof -tiTCP:3000 -sTCP:LISTEN); do ps -o pid,lstart,command -p $p; done",
  "pkill -f \"bun demo/parseLoopB.ts\"; sleep 1; pgrep -fl parseLoopB || echo stopped",
  "tmux capture-pane -p -t crashfix-2026-10-21T04-29-44-857Z-14a3c438 | grep -v '^$' | tail -30",
  "ps aux | rg 'waitForDefinitionRequest' | rg -v ' rg ' | wc -l; ps aux | rg 'waitForDefinitionRequest' | rg -v ' rg ' | awk '{print $2, $9, $10}'",
  "kill 77157 && (pgrep -fl \"ssh -N.*3100\" || echo \"tunnel is off\")",
];

// Commands that change a file, or run no Mac-state program: they run for real.
const NOT_SKIPPED_MAC_STATE_COMMANDS = [
  "tmux send-keys -t x 'node a.js > out.txt' Enter",
  "ps aux | rg node > /tmp/ps.txt",
  "lsof -i :3000 | tee /tmp/x",
  "echo hi",
  // Real Attune Bash calls.
  "cd ~/Programming/Attune && pkill -f \"bun serve.ts\"; git add demo/index.html demo/chat.css && git status --short",
  "pkill -f \"cat > /tmp/dummy\"; rm -f /tmp/dummy; echo ok",
  "ls | rg -v '\\.done$'; for f in *.claimed; do [ -e \"$f\" ] && mv \"$f\" \"${f%.claimed}.json\"; done; ps aux | rg 'waitForDefinitionRequest' | rg -v ' rg ' | wc -l",
  "tmux send-keys -t attune-server:0 C-c; tmux send-keys -t attune-server:tunnel C-c; pkill -f '3100:localhost:3000'; pgrep -fl 'tunnel.sh|3100:localhost|server/server.ts' ; echo \"left: $?\"",
  "bun demo/claimSynthesisRequests.ts; pgrep -fl \"definitionFilesLoop|wheelFitLoopD\"",
];

for (const command of SKIPPED_MAC_STATE_COMMANDS) {
  test(`test_isReadOnlyMacStateCommand_is_true_for: ${command.slice(0, 60)}`, () => {
    // Scenario: the command looks at Mac programs or machine state and changes no file.
    // the command is skipped
    assert.equal(isReadOnlyMacStateCommand(command), true);
  });
}

for (const command of NOT_SKIPPED_MAC_STATE_COMMANDS) {
  test(`test_isReadOnlyMacStateCommand_is_false_for: ${command.slice(0, 60)}`, () => {
    // Scenario: the command changes a file, or looks at no Mac program or machine state.
    // the command is not skipped
    assert.equal(isReadOnlyMacStateCommand(command), false);
  });
}
