import hashlib
import json
import os
import re
import signal
import subprocess
import sys

OUTPUT_LIMIT = 1048576
HOME_FOLDER = "/tmp/home"
PYTHON_SCRIPT_PATH = "/tmp/__script__.py"
STORE_FOLDER = "/store"
OUTPUT_FOLDER = "/tmp/output"

COMMAND_NOT_FOUND = re.compile(r": ([^\s:]+): command not found")
FILE_NOT_FOUND = re.compile(r"FileNotFoundError: \[Errno 2\] No such file or directory: '([^']*)'")
MODULE_NOT_FOUND = re.compile(r"ModuleNotFoundError: No module named '([^']*)'")


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(2)


def check_relative_path(relative_path):
    if os.path.isabs(relative_path):
        fail("input path is absolute: " + relative_path)
    if ".." in relative_path.split("/"):
        fail("input path holds a .. segment: " + relative_path)


def check_cwd_inside_project_root(cwd, project_root):
    normal_cwd = os.path.normpath(cwd)
    normal_root = os.path.normpath(project_root)
    if normal_cwd != normal_root:
        if not normal_cwd.startswith(normal_root.rstrip("/") + "/"):
            fail("cwd is outside the project root: " + cwd)


def read_input_bytes(input_file):
    source = input_file["source"]
    if source["kind"] == "text":
        return source["text"].encode("utf-8")
    check_relative_path(source["repoRelativePath"])
    blob_name = os.path.basename(input_file["relativePath"])
    git_directory = STORE_FOLDER + "/" + source["repoRelativePath"]
    result = subprocess.run(
        ["git", "--git-dir=" + git_directory, "cat-file", "blob", source["commitHash"] + ":" + blob_name],
        capture_output=True,
    )
    if result.returncode != 0:
        fail("git cat-file failed for " + input_file["relativePath"] + ": " + result.stderr.decode("utf-8", "replace"))
    return result.stdout


def write_inputs(request):
    input_hashes = {}
    for input_file in request["inputs"]:
        relative_path = input_file["relativePath"]
        check_relative_path(relative_path)
        file_bytes = read_input_bytes(input_file)
        target_path = os.path.join(request["projectRoot"], relative_path)
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "wb") as target_file:
            target_file.write(file_bytes)
        input_hashes[relative_path] = hashlib.sha256(file_bytes).hexdigest()
    return input_hashes


def build_command(request):
    if request["interpreter"] == "python3":
        with open(PYTHON_SCRIPT_PATH, "w") as script_file:
            script_file.write(request["source"])
        return ["python3", PYTHON_SCRIPT_PATH]
    return ["bash", "-c", request["source"]]


def read_output_text(path):
    with open(path, "rb") as output_file:
        raw_bytes = output_file.read(OUTPUT_LIMIT * 4)
    return raw_bytes.decode("utf-8", "replace")[:OUTPUT_LIMIT]


def run_script(request):
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    stdout_path = OUTPUT_FOLDER + "/stdout"
    stderr_path = OUTPUT_FOLDER + "/stderr"
    command = build_command(request)
    timed_out = False
    # Output goes to files, not pipes: a background process that keeps a pipe open would block the wait.
    with open(stdout_path, "wb") as stdout_file, open(stderr_path, "wb") as stderr_file:
        process = subprocess.Popen(
            command,
            cwd=request["cwd"],
            stdin=subprocess.DEVNULL,
            stdout=stdout_file,
            stderr=stderr_file,
            start_new_session=True,
        )
        try:
            process.wait(timeout=request["timeoutSeconds"])
        except subprocess.TimeoutExpired:
            timed_out = True
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass  # the whole group already ended
    process.wait()
    return process.returncode, timed_out, read_output_text(stdout_path), read_output_text(stderr_path)


def list_project_files(project_root):
    relative_paths = []
    for folder, folder_names, file_names in os.walk(project_root, followlinks=False):
        for file_name in file_names:
            full_path = os.path.join(folder, file_name)
            if not os.path.islink(full_path):
                relative_paths.append(os.path.relpath(full_path, project_root))
    return sorted(relative_paths)


def describe_file(project_root, relative_path, change_kind):
    with open(os.path.join(project_root, relative_path), "rb") as project_file:
        file_bytes = project_file.read()
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return {"relativePath": relative_path, "changeKind": change_kind, "text": None, "isNotText": True}
    return {"relativePath": relative_path, "changeKind": change_kind, "text": text, "isNotText": False}


def collect_changed_files(project_root, input_hashes):
    changed_files = []
    current_paths = list_project_files(project_root)
    for relative_path in current_paths:
        if relative_path not in input_hashes:
            changed_files.append(describe_file(project_root, relative_path, "created"))
            continue
        with open(os.path.join(project_root, relative_path), "rb") as project_file:
            current_hash = hashlib.sha256(project_file.read()).hexdigest()
        if current_hash != input_hashes[relative_path]:
            changed_files.append(describe_file(project_root, relative_path, "changed"))
    for relative_path in sorted(input_hashes):
        if relative_path not in current_paths:
            changed_files.append({"relativePath": relative_path, "changeKind": "deleted", "text": None, "isNotText": False})
    return changed_files


def find_missing_executable(exit_code, stderr):
    matches = []
    if exit_code == 127:
        matches += [(match.start(), match.group(1)) for match in COMMAND_NOT_FOUND.finditer(stderr)]
    # Python prints the same FileNotFoundError for a missing data file; only a failed program start has this traceback line.
    if "in _execute_child" in stderr:
        matches += [(match.start(), match.group(1)) for match in FILE_NOT_FOUND.finditer(stderr)]
    matches += [(match.start(), match.group(1)) for match in MODULE_NOT_FOUND.finditer(stderr)]
    if not matches:
        return None
    return max(matches)[1]


def main():
    request = json.load(sys.stdin)
    os.makedirs(HOME_FOLDER, exist_ok=True)
    check_cwd_inside_project_root(request["cwd"], request["projectRoot"])
    input_hashes = write_inputs(request)
    os.makedirs(request["cwd"], exist_ok=True)
    exit_code, timed_out, stdout, stderr = run_script(request)
    response = {
        "exitCode": exit_code,
        "timedOut": timed_out,
        "stdout": stdout,
        "stderr": stderr,
        "changedFiles": collect_changed_files(request["projectRoot"], input_hashes),
        "missingExecutable": find_missing_executable(exit_code, stderr),
    }
    print(json.dumps(response))


main()
