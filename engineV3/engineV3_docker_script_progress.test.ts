import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DOCKER_SCRIPT_PATH = join(import.meta.dirname, "run_replay_in_docker.sh");
// The order in which the script runs its setup stages.
const SETUP_STAGE_NAMES = ["state-folder cwd scan", "lockfile collection", "docker build", "mounts", "hook files", "container start", "stand-ins", "engine start", "copy-out", "disk check"];

function readDockerScriptLines(): string[] {
    return readFileSync(DOCKER_SCRIPT_PATH, "utf8").split("\n");
}

function findFirstLineIndex(scriptLines: string[], wantedLine: string): number {
    for (const [lineIndex, scriptLine] of scriptLines.entries()) {
        if (scriptLine.trim() === wantedLine) {
            return lineIndex;
        }
    }
    return -1;
}

function findStageStartLineIndex(scriptLines: string[], stageName: string): number {
    return findFirstLineIndex(scriptLines, `printSetupStageStart "${stageName}"`);
}

function findStageDoneLineIndex(scriptLines: string[], stageName: string): number {
    return findFirstLineIndex(scriptLines, `printSetupStageDone "${stageName}"`);
}

// The two print functions, cut out of the script so they can run on their own.
function readSetupStageFunctionsText(): string {
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const functionsStart = scriptText.indexOf("printSetupStageStart() {");
    const functionsEnd = scriptText.indexOf("\n}\n", scriptText.indexOf("printSetupStageDone() {")) + 3;
    assert.notEqual(functionsStart, -1, "the script defines printSetupStageStart");
    return scriptText.slice(functionsStart, functionsEnd);
}

test("test_run_replay_in_docker_passes_the_sh_syntax_check", () => {
    // Scenario: `sh -n` reads the whole script without running it and finds no syntax error.
    execFileSync("sh", ["-n", DOCKER_SCRIPT_PATH]);
});

test("test_every_setup_stage_has_a_start_line_and_a_done_line", () => {
    // Scenario: each stage name has one start print call and one done print call in the script.
    const scriptLines = readDockerScriptLines();
    for (const stageName of SETUP_STAGE_NAMES) {
        assert.notEqual(findStageStartLineIndex(scriptLines, stageName), -1, `start line for ${stageName}`);
        assert.notEqual(findStageDoneLineIndex(scriptLines, stageName), -1, `done line for ${stageName}`);
    }
});

test("test_every_setup_stage_starts_before_it_is_done", () => {
    // Scenario: the start print call of each stage comes before its done print call.
    const scriptLines = readDockerScriptLines();
    for (const stageName of SETUP_STAGE_NAMES) {
        const startLineIndex = findStageStartLineIndex(scriptLines, stageName);
        const doneLineIndex = findStageDoneLineIndex(scriptLines, stageName);
        assert.ok(startLineIndex < doneLineIndex, `${stageName}: start line ${startLineIndex} is before done line ${doneLineIndex}`);
    }
});

test("test_setup_stages_run_in_the_listed_order", () => {
    // Scenario: each stage's done line comes before the next stage's start line.
    const scriptLines = readDockerScriptLines();
    for (let stageIndex = 1; stageIndex < SETUP_STAGE_NAMES.length; stageIndex++) {
        const earlierStageName = SETUP_STAGE_NAMES[stageIndex - 1] as string;
        const laterStageName = SETUP_STAGE_NAMES[stageIndex] as string;
        const earlierDoneLineIndex = findStageDoneLineIndex(scriptLines, earlierStageName);
        const laterStartLineIndex = findStageStartLineIndex(scriptLines, laterStageName);
        assert.ok(earlierDoneLineIndex < laterStartLineIndex, `${earlierStageName} is done before ${laterStageName} starts`);
    }
});

test("test_hook_files_stage_mounts_the_db4822d_parent_hook_files_at_the_claude_folder", () => {
    // Scenario: the recorded `node ~/.claude/hooks/turn-done.ts` needs turn-done.ts, ../shared and ../.env, taken from claude_hooks at db4822d~1.
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    assert.match(scriptText, /archive db4822d~1 ask-dont-dump-issues shared \| tar -x -C "\$HOOK_FILES_FOLDER"/);
    // sh has no pipefail, so the script stops by itself when the archive gave no turn-done.ts.
    assert.match(scriptText, /if \[ ! -f "\$HOOK_FILES_FOLDER\/ask-dont-dump-issues\/turn-done\.ts" \]; then/);
    assert.match(scriptText, /CLAUDE_HOOKS_SESSION_STATE_DIR=\/tmp\/claude-hooks-session-state/);
    assert.match(scriptText, /"\$HOOK_FILES_FOLDER\/ask-dont-dump-issues:\/Users\/matkatmusicllc\/\.claude\/hooks:ro"/);
    assert.match(scriptText, /"\$HOOK_FILES_FOLDER\/shared:\/Users\/matkatmusicllc\/\.claude\/shared:ro"/);
    assert.match(scriptText, /"\$HOOK_FILES_FOLDER\/\.env:\/Users\/matkatmusicllc\/\.claude\/\.env:ro"/);
});

// The paths outside the Attune project that recorded Attune Bash calls read; each one exists on the Mac.
const ATTUNE_OUTSIDE_PATHS = [
    "/Users/matkatmusicllc/Programming/harms",
    "/Users/matkatmusicllc/Programming/taskTools",
    "/Users/matkatmusicllc/Programming/sms_extractor",
    "/Users/matkatmusicllc/Programming/relationship-mermaid",
    "/Users/matkatmusicllc/Programming/wheels",
    "/Users/matkatmusicllc/Programming/nrc-eil",
    "/Users/matkatmusicllc/Programming/taskTools-worktrees",
    "/Users/matkatmusicllc/Programming/matkat_claude_libs",
    "/Users/matkatmusicllc/Programming/taskTools-86",
    "/Users/matkatmusicllc/Programming/message-panel",
    "/Users/matkatmusicllc/Programming/taskTools-frozen",
    "/Users/matkatmusicllc/Downloads/dictionary-pages",
    "/Users/matkatmusicllc/Desktop/AffectVec-v1.0",
    "/Users/matkatmusicllc/Desktop/Feelings+Wheel+Download-ables.pdf",
    "/Users/matkatmusicllc/.claude/plugins",
    "/Users/matkatmusicllc/.claude/tasks",
    "/Users/matkatmusicllc/.claude/skills",
    "/Users/matkatmusicllc/.claude/sessions",
    "/Users/matkatmusicllc/.claude/array-debt",
    "/Users/matkatmusicllc/.claude/usage-data",
    "/Users/matkatmusicllc/.claude/debug",
    "/Users/matkatmusicllc/.claude/commands",
];

function readAttuneOutsidePathsFromScript(): string[] {
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const listMatch = /^\s*ATTUNE_OUTSIDE_PATHS="([^"]*)"$/m.exec(scriptText);
    assert.ok(listMatch !== null, "the script sets ATTUNE_OUTSIDE_PATHS");
    return (listMatch[1] as string).split(/\s+/).filter((outsidePath) => outsidePath.length > 0);
}

// The loop over ATTUNE_OUTSIDE_PATHS, cut out of the script so it can run on its own.
function readAttuneOutsidePathsLoopText(): string {
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const loopStart = scriptText.indexOf("for OUTSIDE_PATH in $ATTUNE_OUTSIDE_PATHS; do");
    assert.notEqual(loopStart, -1, "the script loops over ATTUNE_OUTSIDE_PATHS");
    const loopEnd = scriptText.indexOf("\n    done\n", loopStart) + "\n    done\n".length;
    return scriptText.slice(loopStart, loopEnd);
}

test("test_hook_files_stage_mounts_the_taskTools_git_folder_read_only_at_the_same_path", () => {
    // Scenario: the replay runs the recorded taskTools reflow hook at the commit of each event's time, so it reads the taskTools git folder.
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    assert.match(scriptText, /-v "\$TASK_TOOLS_GIT_FOLDER:\$TASK_TOOLS_GIT_FOLDER:ro"/);
    assert.match(scriptText, /TASK_TOOLS_GIT_FOLDER=\/Users\/matkatmusicllc\/Programming\/taskTools\/\.git/);
});

test("test_attune_replay_mounts_every_outside_path_read_only_at_the_same_path", () => {
    // Scenario: recorded Attune Bash calls read folders outside the project, such as `cd ~/Programming/harms/fight-review`.
    // The script lists exactly those paths, only for the Attune state folder.
    assert.deepEqual(readAttuneOutsidePathsFromScript(), ATTUNE_OUTSIDE_PATHS);
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    assert.match(scriptText, /if \[ "\$STATE_FOLDER" = "\/Users\/matkatmusicllc\/Programming\/Attune" \]; then\n\s*ATTUNE_OUTSIDE_PATHS=/);
    // Each path is mounted read-only at its own Mac path.
    assert.match(readAttuneOutsidePathsLoopText(), /set -- "\$@" -v "\$OUTSIDE_PATH:\$OUTSIDE_PATH:ro"/);
});

test("test_attune_outside_paths_loop_mounts_an_existing_path_read_only", () => {
    // Scenario: the loop runs in sh with one path that exists and puts one read-only mount pair in "$@".
    const loopText = readAttuneOutsidePathsLoopText();
    // The list is split on spaces, so the test uses the temp folder: the worktree path has spaces.
    const existingPath = tmpdir();
    const output = execFileSync("sh", ["-eu", "-c", `ATTUNE_OUTSIDE_PATHS="${existingPath}"\nset --\n${loopText}printf '%s\\n' "$@"\n`], { encoding: "utf8" });
    assert.deepEqual(output.trim().split("\n"), ["-v", `${existingPath}:${existingPath}:ro`]);
});

test("test_attune_outside_paths_loop_mounts_a_git_folder_at_outside_live_and_its_git_folder_at_the_mac_path", (t) => {
    // Scenario: a git folder with a HEAD log goes to /outside-live, so the engine can fill its Mac path with the files of the event's time.
    const loopText = readAttuneOutsidePathsLoopText();
    const gitPath = mkdtempSync(join(tmpdir(), "engine-v3-outside-git-"));
    t.after(() => rmSync(gitPath, { recursive: true, force: true }));
    mkdirSync(join(gitPath, ".git", "logs"), { recursive: true });
    writeFileSync(join(gitPath, ".git", "logs", "HEAD"), "");
    const output = execFileSync("sh", ["-eu", "-c", `ATTUNE_OUTSIDE_PATHS="${gitPath}"\nOUTSIDE_GIT_FOLDERS=""\nset --\n${loopText}printf '%s\\n' "$@" "folders:$OUTSIDE_GIT_FOLDERS"\n`], { encoding: "utf8" });
    // the live folder is read-only at /outside-live, its .git is read-only at the Mac path, and the folder is listed for the engine
    assert.deepEqual(output.trim().split("\n"), ["-v", `${gitPath}:/outside-live${gitPath}:ro`, "-v", `${gitPath}/.git:${gitPath}/.git:ro`, `folders: ${gitPath}`]);
});

test("test_attune_outside_paths_loop_stops_on_a_missing_path", () => {
    // Scenario: docker would make a missing mount source as an empty root-owned folder on the Mac, so the loop stops with a message instead.
    const loopText = readAttuneOutsidePathsLoopText();
    const missingPath = join(tmpdir(), "no-such-outside-path");
    assert.throws(
        () => execFileSync("sh", ["-eu", "-c", `ATTUNE_OUTSIDE_PATHS="${missingPath}"\nset --\n${loopText}`], { encoding: "utf8", stdio: "pipe" }),
        (error: { status: number; stderr: string }) => error.status !== 0 && error.stderr.includes(`${missingPath} does not exist on the Mac`),
    );
});

test("test_claude_settings_file_is_linked_into_the_mounted_dotfiles", () => {
    // Scenario: on the Mac ~/.claude/settings.json is a link into the dotfiles folder, which is mounted already.
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    assert.match(scriptText, /docker exec "\$NAME" ln -sfn \/Users\/matkatmusicllc\/Programming\/dotfiles\/claude\/settings\.json \/Users\/matkatmusicllc\/\.claude\/settings\.json/);
});

test("test_replay_container_starts_with_the_network_on", () => {
    // Scenario: user decision 8: recorded internet calls that change files need the network.
    // the one container start line that runs is the one without --network none
    const containerStartLines = readDockerScriptLines().filter((scriptLine) => scriptLine.startsWith("docker run -d "));
    assert.equal(containerStartLines.length, 1);
    assert.doesNotMatch(containerStartLines[0]!, /--network none/);
    // the old line with --network none is kept as a comment
    assert.ok(readDockerScriptLines().some((scriptLine) => scriptLine.startsWith("# docker run -d --network none ")));
});

test("test_stand_in_listeners_start_only_for_the_typesafe_playground_project", () => {
    // Scenario: the stand-ins in engineV3_standins.json stand for programs on the typesafe-playground Mac; Attune starts its own server on port 3000, so the port must be free there.
    const scriptLines = readDockerScriptLines();
    const stageLines = scriptLines.slice(findStageStartLineIndex(scriptLines, "stand-ins") + 1, findStageDoneLineIndex(scriptLines, "stand-ins")).filter((scriptLine) => scriptLine.trim() !== "" && !scriptLine.trim().startsWith("#"));
    // the stage is one if block for typesafe-playground
    assert.equal(stageLines[0]!.trim(), 'if [ "$GIT_REPO_FOLDER" = "/Users/matkatmusicllc/Programming/typesafe-playground" ]; then');
    assert.equal(stageLines[stageLines.length - 1]!.trim(), "fi");
    // both listener start lines sit inside the block
    const listenerLines = stageLines.filter((scriptLine) => scriptLine.includes("docker exec -d -u replay"));
    assert.equal(listenerLines.length, 2);
    for (const listenerLine of listenerLines) {
        assert.ok(listenerLine.startsWith("    "), "the listener start line is indented inside the block");
    }
});

test("test_dockerfile_wraps_pkill_and_pgrep_so_they_skip_the_shell_that_runs_the_command", () => {
    // Scenario: on the Mac a recorded `pkill -f "bun demo/server.ts"` does not kill the shell that holds that text; on Linux it does, unless the program is told to ignore its ancestors.
    const dockerfileText = readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8");
    // each wrapper is a file in /usr/local/bin that runs the real program with --ignore-ancestors
    for (const programName of ["pkill", "pgrep"]) {
        assert.match(dockerfileText, new RegExp(`COPY --chmod=755 <<'[A-Z_]+' /usr/local/bin/${programName}\\n#!/bin/sh\\nexec /usr/bin/${programName} --ignore-ancestors "\\$@"\\n`));
    }
});

function readDockerfileClaudeStandInText(): string {
    const dockerfileText = readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8");
    const startMarker = "COPY --chmod=755 <<'CLAUDE_SCRIPT' /usr/local/bin/claude\n";
    const startIndex = dockerfileText.indexOf(startMarker);
    assert.notEqual(startIndex, -1, "the Dockerfile writes a claude stand-in to /usr/local/bin/claude");
    const bodyStartIndex = startIndex + startMarker.length;
    const bodyEndIndex = dockerfileText.indexOf("\nCLAUDE_SCRIPT\n", bodyStartIndex);
    assert.notEqual(bodyEndIndex, -1);
    return dockerfileText.slice(bodyStartIndex, bodyEndIndex + 1);
}

for (const standInArguments of [["--version"], ["--help"], ["plugin", "--help"], ["plugin", "validate", "demo/crash-fix-mod"]]) {
    test(`test_dockerfile_claude_stand_in_exits_0_and_prints_nothing_for: claude ${standInArguments.join(" ")}`, () => {
        // Scenario: recorded calls only look at the Mac claude program (user decision: skip these commands), so the stand-in does nothing.
        const standInText = readDockerfileClaudeStandInText();
        // the stand-in runs in sh with the recorded arguments
        const standInRun = spawnSync("sh", ["-s", "--", ...standInArguments], { input: standInText, encoding: "utf8" });
        // it exits 0 with no output
        assert.equal(standInRun.status, 0);
        assert.equal(standInRun.stdout, "");
        assert.equal(standInRun.stderr, "");
    });
}

for (const standInArguments of [["-p", "--system-prompt-file", "prompt.md"], []]) {
    test(`test_dockerfile_claude_stand_in_fails_loudly_for: claude ${standInArguments.join(" ")}`, () => {
        // Scenario: the Attune app runs claude -p; the stand-in cannot answer, so it must fail instead of returning nothing.
        const standInText = readDockerfileClaudeStandInText();
        // the stand-in runs in sh with arguments it does not know
        const standInRun = spawnSync("sh", ["-s", "--", ...standInArguments], { input: standInText, encoding: "utf8" });
        // it exits non-zero and says why on stderr
        assert.notEqual(standInRun.status, 0);
        assert.match(standInRun.stderr, /claude stand-in/);
    });
}

test("test_dockerfile_installs_tmux", () => {
    // Scenario: recorded Bash calls run tmux new-session and send-keys for real, so the image needs tmux.
    // the one apt-get install line that runs names tmux
    const dockerfileLines = readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8").split("\n");
    const installLines = dockerfileLines.filter((dockerfileLine) => dockerfileLine.trimStart().startsWith("&& apt-get install "));
    assert.equal(installLines.length, 1);
    assert.match(installLines[0]!, / tmux( |$)/);
});

test("test_dockerfile_installs_chromium_at_the_mac_chrome_path", () => {
    // Scenario: recorded bun scripts start "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" headless, so the image needs a real Chromium at that path.
    const dockerfileText = readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8");
    // the one apt-get install line that runs names chromium
    const installLines = dockerfileText.split("\n").filter((dockerfileLine) => dockerfileLine.trimStart().startsWith("&& apt-get install "));
    assert.equal(installLines.length, 1);
    assert.match(installLines[0]!, / chromium( |$)/);
    // a file at the Mac Chrome path runs chromium without the sandbox and without /dev/shm
    assert.ok(dockerfileText.includes('"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'));
    assert.ok(dockerfileText.includes('exec chromium --no-sandbox --disable-dev-shm-usage "$@"'));
});

test("test_dockerfile_installs_file_bc_xxd_and_pdftotext", () => {
    // Scenario: recorded Bash calls run file, bc, xxd and pdftotext, so the image needs them.
    const dockerfileLines = readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8").split("\n");
    // the one apt-get install line that runs names each package
    const installLines = dockerfileLines.filter((dockerfileLine) => dockerfileLine.trimStart().startsWith("&& apt-get install "));
    assert.equal(installLines.length, 1);
    for (const packageName of ["file", "bc", "xxd", "poppler-utils"]) {
        assert.match(installLines[0]!, new RegExp(` ${packageName}( |$)`));
    }
});

// The body of one Dockerfile stand-in, written to a temp file so tests can run it with sh.
function writeDockerfileStandInScript(heredocName: string, standInPath: string, testFolder: string): string {
    const dockerfileText = readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8");
    const startMarker = `COPY --chmod=755 <<'${heredocName}' ${standInPath}\n`;
    const startIndex = dockerfileText.indexOf(startMarker);
    assert.notEqual(startIndex, -1, `the Dockerfile writes a stand-in to ${standInPath}`);
    const bodyStartIndex = startIndex + startMarker.length;
    const bodyEndIndex = dockerfileText.indexOf(`\n${heredocName}\n`, bodyStartIndex);
    assert.notEqual(bodyEndIndex, -1);
    const standInScriptPath = join(testFolder, `${heredocName}.sh`);
    writeFileSync(standInScriptPath, dockerfileText.slice(bodyStartIndex, bodyEndIndex + 1));
    return standInScriptPath;
}

// A program that prints each of its arguments on its own line, in place of the real sed.
function writeArgumentPrinter(testFolder: string): string {
    const printerPath = join(testFolder, "print-arguments");
    writeFileSync(printerPath, "#!/bin/sh\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\"; done\n", { mode: 0o755 });
    return printerPath;
}

function runSedStandIn(sedArguments: string[]): { status: number | null; stdout: string; stderr: string } {
    const testFolder = mkdtempSync(join(tmpdir(), "sed-stand-in-"));
    const standInScriptPath = writeDockerfileStandInScript("SED_SCRIPT", "/usr/local/bin/sed", testFolder);
    const printerPath = writeArgumentPrinter(testFolder);
    const standInRun = spawnSync("sh", [standInScriptPath, ...sedArguments], { encoding: "utf8", env: { ...process.env, SED_STAND_IN_REAL_SED: printerPath } });
    rmSync(testFolder, { recursive: true, force: true });
    return standInRun;
}

for (const [sedArguments, realSedArguments] of [
    [["-i", "", "s/a/b/", "f"], ["-i", "s/a/b/", "f"]],
    [["-i", "", "-E", "s/a+/b/", "f", "g"], ["-i", "-E", "s/a+/b/", "f", "g"]],
    [["-i", "", "-e", "1s/a/b/", "-e", "2s/a/b/", "f"], ["-i", "-e", "1s/a/b/", "-e", "2s/a/b/", "f"]],
    [["-n", "1p", "f"], ["-n", "1p", "f"]],
    [["-i.bak", "s/a/b/", "f"], ["-i.bak", "s/a/b/", "f"]],
]) {
    test(`test_dockerfile_sed_stand_in_runs_the_real_sed_with: ${JSON.stringify(realSedArguments)} for sed ${JSON.stringify(sedArguments)}`, () => {
        // Scenario: BSD `sed -i ''` means "edit in place, no backup"; GNU sed reads the '' as the script, so the stand-in drops it.
        // the stand-in runs the real sed (here a program that prints its arguments)
        const standInRun = runSedStandIn(sedArguments!);
        // the real sed gets the translated arguments
        assert.equal(standInRun.status, 0);
        assert.deepEqual(standInRun.stdout.split("\n").slice(0, -1), realSedArguments);
    });
}

for (const sedArguments of [["-i", "24d", "f"], ["-i"], ["-n", "-i", "", "1p", "f"]]) {
    test(`test_dockerfile_sed_stand_in_fails_loudly_for: sed ${JSON.stringify(sedArguments)}`, () => {
        // Scenario: on the Mac `sed -i 24d f` takes 24d as the backup suffix and fails; GNU sed would edit f, so the stand-in must fail.
        const standInRun = runSedStandIn(sedArguments);
        // the real sed never runs, and the stand-in says why on stderr
        assert.notEqual(standInRun.status, 0);
        assert.equal(standInRun.stdout, "");
        assert.match(standInRun.stderr, /sed stand-in/);
    });
}

// Runs the stat stand-in in a folder that holds the file "f"; fake stat and date print their arguments in brackets.
function runStatStandIn(statArguments: string[], fakeStatOutput?: string): { status: number | null; stdout: string; stderr: string } {
    const testFolder = mkdtempSync(join(tmpdir(), "stat-stand-in-"));
    const standInScriptPath = writeDockerfileStandInScript("STAT_SCRIPT", "/usr/local/bin/stat", testFolder);
    writeFileSync(join(testFolder, "f"), "file text\n");
    const fakeStatPath = join(testFolder, "fake-stat");
    writeFileSync(fakeStatPath, "#!/bin/sh\necho \"${FAKE_STAT_OUTPUT:-stat[$*]}\"\n", { mode: 0o755 });
    const fakeDatePath = join(testFolder, "fake-date");
    writeFileSync(fakeDatePath, "#!/bin/sh\necho \"date[$*]\"\n", { mode: 0o755 });
    const standInEnvironment: NodeJS.ProcessEnv = { ...process.env, STAT_STAND_IN_REAL_STAT: fakeStatPath, STAT_STAND_IN_REAL_DATE: fakeDatePath };
    if (fakeStatOutput !== undefined) {
        standInEnvironment.FAKE_STAT_OUTPUT = fakeStatOutput;
    }
    const standInRun = spawnSync("sh", [standInScriptPath, ...statArguments], { encoding: "utf8", cwd: testFolder, env: standInEnvironment });
    rmSync(testFolder, { recursive: true, force: true });
    return standInRun;
}

for (const [statArguments, expectedOutput] of [
    [["-f", "%m", "f"], "stat[-c %Y -- f]\n"],
    [["-f", "%z", "f"], "stat[-c %s -- f]\n"],
    [["-f", "%Sm", "f"], "date[-d @stat[-c %Y -- f] +%b %e %H:%M:%S %Y]\n"],
    [["-f", "%Sm", "-t", "%T", "f", "f"], "date[-d @stat[-c %Y -- f] +%T]\ndate[-d @stat[-c %Y -- f] +%T]\n"],
    [["-f", "%Sm %z %N", "-t", "%m-%d %H:%M", "f"], "date[-d @stat[-c %Y -- f] +%m-%d %H:%M] stat[-c %s -- f] f\n"],
    [["-f", "%N %Sm birth=%SB", "f"], "f date[-d @stat[-c %Y -- f] +%b %e %H:%M:%S %Y] birth=date[-d @stat[-c %W -- f] +%b %e %H:%M:%S %Y]\n"],
    [["f"], "stat[f]\n"],
]) {
    test(`test_dockerfile_stat_stand_in_translates: stat ${JSON.stringify(statArguments)}`, () => {
        // Scenario: BSD `stat -f <format>` prints file facts; GNU `stat -f` means "file system", so the stand-in asks GNU stat and date for each fact.
        const standInRun = runStatStandIn(statArguments as string[]);
        // the output joins the facts in the shape of the BSD format
        assert.equal(standInRun.stderr, "");
        assert.equal(standInRun.status, 0);
        assert.equal(standInRun.stdout, expectedOutput);
    });
}

test("test_dockerfile_stat_stand_in_reports_a_missing_file_like_the_mac_and_goes_on", () => {
    // Scenario: recorded `stat -f "%Sm %z %N" -t "%H:%M" layers.json ...` printed the Mac error for the missing file and still printed the others.
    const standInRun = runStatStandIn(["-f", "%z", "missing.json", "f"]);
    // the missing file gets the Mac message, the other file still prints, and the exit status is 1
    assert.equal(standInRun.stderr, "stat: missing.json: stat: No such file or directory\n");
    assert.equal(standInRun.stdout, "stat[-c %s -- f]\n");
    assert.equal(standInRun.status, 1);
});

for (const [statArguments, fakeStatOutput] of [[["-f", "%p", "f"]], [["-L", "-f", "%m", "f"]], [["-f", "%m", "-x", "f"]], [["-f", "%SB", "f"], "0"], [["-f", "%SB", "f"], "-"]] as [string[], string?][]) {
    test(`test_dockerfile_stat_stand_in_fails_loudly_for: stat ${JSON.stringify(statArguments)} with GNU output ${fakeStatOutput}`, () => {
        // Scenario: a BSD stat form the stand-in does not translate, or a birth time GNU stat cannot give, must not print a wrong answer.
        const standInRun = runStatStandIn(statArguments, fakeStatOutput);
        // the stand-in exits non-zero and says why on stderr
        assert.notEqual(standInRun.status, 0);
        assert.equal(standInRun.stdout, "");
        assert.match(standInRun.stderr, /stat stand-in/);
    });
}

// Runs the md5 stand-in in a folder that holds files "f" and "g"; fake md5sum prints a hash made from its input.
function runMd5StandIn(md5Arguments: string[], standardInput: string): { status: number | null; stdout: string; stderr: string } {
    const testFolder = mkdtempSync(join(tmpdir(), "md5-stand-in-"));
    const standInScriptPath = writeDockerfileStandInScript("MD5_SCRIPT", "/usr/local/bin/md5", testFolder);
    writeFileSync(join(testFolder, "f"), "f text\n");
    writeFileSync(join(testFolder, "g"), "g text\n");
    const fakeMd5sumPath = join(testFolder, "fake-md5sum");
    writeFileSync(fakeMd5sumPath, "#!/bin/sh\nif [ $# -eq 0 ]; then\n    echo \"stdinhash-$(cat)  -\"\nelse\n    echo \"filehash-$1  $1\"\nfi\n", { mode: 0o755 });
    const standInRun = spawnSync("sh", [standInScriptPath, ...md5Arguments], { encoding: "utf8", cwd: testFolder, input: standardInput, env: { ...process.env, MD5_STAND_IN_REAL_MD5SUM: fakeMd5sumPath } });
    rmSync(testFolder, { recursive: true, force: true });
    return standInRun;
}

for (const [md5Arguments, expectedOutput] of [
    [["f"], "MD5 (f) = filehash-f\n"],
    [["-q", "f"], "filehash-f\n"],
    [["-q", "f", "g"], "filehash-f\nfilehash-g\n"],
    [[], "stdinhash-piped\n"],
] as [string[], string][]) {
    test(`test_dockerfile_md5_stand_in_prints_the_mac_shape_for: md5 ${JSON.stringify(md5Arguments)}`, () => {
        // Scenario: Mac md5 prints "MD5 (f) = hash"; with -q only the hash per file; with no file only the hash of stdin.
        const standInRun = runMd5StandIn(md5Arguments, "piped");
        assert.equal(standInRun.stderr, "");
        assert.equal(standInRun.status, 0);
        assert.equal(standInRun.stdout, expectedOutput);
    });
}

for (const md5Arguments of [["-s", "text"], ["-q"]]) {
    test(`test_dockerfile_md5_stand_in_fails_loudly_for: md5 ${JSON.stringify(md5Arguments)}`, () => {
        // Scenario: md5 forms that no recorded call uses must not print a wrong answer.
        const standInRun = runMd5StandIn(md5Arguments, "piped");
        assert.notEqual(standInRun.status, 0);
        assert.equal(standInRun.stdout, "");
        assert.match(standInRun.stderr, /md5 stand-in/);
    });
}

test("test_setup_stage_lines_print_the_iso_time_and_the_seconds", () => {
    // Scenario: the two print functions run in sh and print "<ISO time> setup: <stage>" and "<ISO time> setup: <stage> done in <N>s".
    const output = execFileSync("sh", ["-eu", "-c", `${readSetupStageFunctionsText()}\nprintSetupStageStart "example stage"\nprintSetupStageDone "example stage"\n`], { encoding: "utf8" });
    const outputLines = output.trim().split("\n");
    assert.equal(outputLines.length, 2);
    assert.match(outputLines[0] as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z setup: example stage$/);
    assert.match(outputLines[1] as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z setup: example stage done in \d+s$/);
});
