# engineV3: Bash command types in the chat logs

Source: every Bash tool call in the typesafe-playground chat logs (2,406 Bash calls in 158 JSONL files).
Folders: `~/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground` and `~/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground-playground`.
Each single call is in `engineV3_commands.json`, with its `modifying` flag and its JSONL path and line.

Totals: 1,063 calls are `modifying: true`. 1,343 calls are `modifying: false` (skip).

## Counting rules

1. One Bash call can hold many commands (`&&`, `||`, `;`, `|`, new lines, `$( )`, `<( )`). Each command counts once in the tables. Heredoc text is not counted.
2. A command is "modifying" when it can write a file anywhere, inside or outside the typesafe-playground folder (user ruling 2026-11-07).
3. A Bash call is `modifying: true` when one or more of its commands is modifying.
4. A write by `>`, `>>`, `&>` or `tee` counts, except to `/dev/null`, `/dev/stderr`, `/dev/stdout`.
5. Commands that run code we cannot see (`bun test`, `node x.ts`, `python3 -`, `bash x.sh`) count as modifying, because the chat log cannot prove that they write nothing.
6. git: each subcommand is its own row, with the same task #712.

## Modifying: these need a replay rule

| Task | Command | Modifying uses | Why |
|---|---|---|---|
| #720 | bun | 653 of 657 | Runs tests and scripts. Only `bun --version` is read-only. |
| #724 | node | 175 of 175 | Runs scripts. |
| #712 | git add | 135 of 135 | Changes the git index. |
| #712 | git commit | 131 of 131 | Commits already replay as commit events. |
| #721 | bunx | 85 of 529 | `bunx tsc` without `--noEmit` writes output; `bunx eslint --fix` changes files. |
| #712 | git checkout | 60 of 60 | Changes work-tree files. |
| #717 | echo | 25 of 1132 | Only with `>` or `>>` to a file. |
| #735 | bash | 25 of 25 | Runs a script file. |
| #736 | mkdir | 24 of 24 | |
| #739 | python3 | 21 of 21 | Runs a script from stdin or `-c`. The docker container has no python3. |
| #738 | cp | 21 of 21 | |
| #712 | git worktree | 20 of 37 | `add`, `remove`, `prune`. `list` is read-only. |
| #742 | rm | 16 of 16 | |
| #718 | cat | 13 of 819 | Only with `>` (often with a heredoc). |
| #712 | git show | 11 of 425 | Only with `>` to a file. |
| #725 | curl | 23 of 170 | With `-o` to a file, or a POST (`-X POST`, `-d`) that makes the local playground server write files (`/run`, `/save`). The docker container has no network. |
| #728 | eslint | 9 of 114 | Only with `--fix`. |
| #712 | git stash | 8 of 25 | `list` and `show` are read-only. |
| #743 | sips | 8 of 15 | Crops in place or with `--out`. `-g` is read-only. macOS only. |
| #754 | Google Chrome | 8 of 8 | Writes a profile folder or a screenshot. Mac app. |
| #753 | ln | 7 of 7 | |
| #712 | git reset | 7 of 7 | |
| #778 | $C (Chrome in a variable) | 6 of 9 | Only with `--screenshot`. `--dump-dom` is read-only. |
| #745 | sd | 6 of 14 | Only when a file name is given. |
| #719 | sed | 5 of 665 | Only with `-i`. |
| #758 | sh | 5 of 5 | Runs a script file. |
| #712 | git branch | 2 of 42 | Only with `-d`, `-D`, `-m`, `-f`. |
| #712 | git merge | 4 of 4 | |
| #712 | git clone | 4 of 4 | Needs network. |
| #778 | $T (tsc in a variable) | 3 of 4 | Only without `--noEmit`. |
| #765 | tar | 3 of 3 | `tar -x` unpacks files. |
| #747 | printf | 2 of 11 | Only with `>` to a file. |
| #712 | git restore | 2 of 2 | |
| #712 | git apply | 2 of 2 | |
| #712 | git rebase | 2 of 2 | |
| #714 | rg | 1 of 1373 | Only with `>` to a file. |
| #712 | git diff | 1 of 391 | Only with `>` to a file. |
| #748 | rtk | 1 of 10 | `rtk recall` (unknown tool). `rtk read`, `rtk rg`, `rtk jq` are read-only. |
| #712 | git pull | 1 of 1 | Needs network. |
| #712 | git submodule | 1 of 1 | `git submodule add` needs network. |
| #772 | tsc | 1 of 1 | No `--noEmit`. |
| #712 | git hash-object | 1 of 1 | `-w` writes into `.git`. |
| #712 | git update-index | 1 of 1 | |
| #712 | git cherry-pick | 1 of 1 | |
| #778 | $ESL (eslint in a variable) | 1 of 1 | Has `--fix`. |
| #775 | rsync | 1 of 1 | |

## Skip: read-only in these chat logs

| Task | Command | Uses |
|---|---|---|
| #713 | cd | 1474 |
| #715 | head | 1268 |
| #716 | tail | 1113 |
| #722 | ls | 433 |
| #712 | git status | 356 |
| #712 | git log | 301 |
| #723 | wc | 254 |
| #726 | grep | 143 |
| #727 | cut | 127 |
| #731 | sleep | 87 |
| #729 | pkill | 85 |
| #730 | jq | 72 |
| #732 | sort | 48 |
| #733 | lsof | 38 |
| #734 | fd | 32 |
| #712 | git ls-tree | 27 |
| #737 | awk | 21 |
| #740 | kill | 20 |
| #741 | uniq | 19 |
| #712 | git ls-files | 16 |
| #744 | nl | 14 |
| #746 | pgrep | 12 |
| - | redirect after a ( ) or { } group (all to /dev/null or 2>&1) | 11 |
| #778 | $E (eslint in a variable, no --fix) | 11 |
| #712 | git grep | 10 |
| #749 | cmp | 9 |
| #750 | tr | 8 |
| #751 | which | 8 |
| #752 | file | 7 |
| #756 | diff | 7 |
| #777 | [ | 7 |
| #778 | $BIN (eslint in a variable, no --fix) | 7 |
| #757 | find | 6 |
| #755 | pwd | 6 |
| #759 | npm (root, ls) | 5 |
| #761 | claude (--version, --help) | 4 |
| #760 | ps | 4 |
| #712 | git rev-parse | 4 |
| #712 | git merge-base | 4 |
| #712 | git check-ignore | 3 |
| #763 | stat | 3 |
| #762 | dirname | 3 |
| #764 | date | 3 |
| #712 | git archive (output goes to a pipe) | 3 |
| #766 | md5 | 3 |
| #777 | true | 2 |
| #777 | break | 2 |
| #768 | gh (issue view) | 2 |
| #777 | set | 2 |
| #712 | git cat-file | 2 |
| #769 | od | 2 |
| #712 | git diff-tree | 2 |
| #777 | read | 2 |
| #767 | ipconfig | 2 |
| #777 | command | 1 |
| #776 | du | 1 |
| #770 | tee (to /dev/stderr) | 1 |
| #777 | exit | 1 |
| #777 | : | 1 |
| #771 | paste | 1 |
| #777 | wait | 1 |
| #712 | git for-each-ref | 1 |
| #712 | git git (a typo) | 1 |
| #712 | git rev-list | 1 |
| #773 | basename | 1 |
| #774 | ifconfig | 1 |

How the list was made: `/private/tmp/claude-501/-Users-matkatmusicllc-Desktop-claude-code-src-RevEng/7fd5444a-23b5-4859-ae03-7e870f42a97b/scratchpad/write_commands_json.py` (uses `bash_segments.py` and `bash_modifying.py` in the same folder).
