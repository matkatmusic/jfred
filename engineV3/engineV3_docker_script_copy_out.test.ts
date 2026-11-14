import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOCKER_SCRIPT_PATH = join(import.meta.dirname, "run_replay_in_docker.sh");

function readCopyOutStageText(): string {
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const stageStart = scriptText.indexOf('printSetupStageStart "copy-out"');
    const stageEnd = scriptText.indexOf('printSetupStageDone "copy-out"');
    assert.notEqual(stageStart, -1, "the script has the copy-out start line");
    assert.notEqual(stageEnd, -1, "the script has the copy-out done line");
    return scriptText.slice(stageStart, stageEnd);
}

function readDiskCheckStageText(): string {
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const stageStart = scriptText.indexOf('printSetupStageStart "disk check"');
    const stageEnd = scriptText.indexOf('printSetupStageDone "disk check"');
    assert.notEqual(stageStart, -1, "the script has the disk check start line");
    assert.notEqual(stageEnd, -1, "the script has the disk check done line");
    return scriptText.slice(stageStart, stageEnd);
}

test("test_copy_out_keeps_the_state_folder_at_its_container_path_under_the_compare_folder", () => {
    // Scenario: the touched paths climb out of the state folder (../../.claude/...), so the copy must keep the container path for the climb to land inside the compare folder.
    // read the copy-out stage
    const copyOutText = readCopyOutStageText();
    // the state folder is copied to the compare folder plus its container path
    assert.ok(copyOutText.includes('docker cp "$NAME:$STATE_FOLDER" "$COMPARE_FOLDER$STATE_FOLDER"'), "the state copy keeps the container path");
    // the parent of that destination exists first, or docker cp fails
    assert.ok(copyOutText.includes('mkdir -p "$COMPARE_FOLDER$(dirname "$STATE_FOLDER")"'), "the parent of the state copy is made");
});

test("test_copy_out_copies_each_memory_folder_with_tar_because_docker_cp_reads_nothing_from_a_tmpfs", () => {
    // Scenario: the memory folder is a tmpfs in the container, and docker cp copies an empty folder from a tmpfs.
    // read the copy-out stage
    const copyOutText = readCopyOutStageText();
    // the container packs the memory folder into a tar file
    assert.ok(copyOutText.includes('docker exec "$NAME" tar -C / -cf "/tmp/memory-$(basename "$JSONL_FOLDER").tar" "${JSONL_FOLDER#/}/memory"'), "the container packs the memory folder");
    // the tar file leaves the container through docker cp (the container root is not a tmpfs)
    assert.ok(copyOutText.includes('docker cp "$NAME:/tmp/memory-$(basename "$JSONL_FOLDER").tar" "$COMPARE_FOLDER/memory-$(basename "$JSONL_FOLDER").tar"'), "the tar file is copied out");
    // the tar file unpacks under the compare folder at the container path
    assert.ok(copyOutText.includes('tar -C "$COMPARE_FOLDER" -xf "$COMPARE_FOLDER/memory-$(basename "$JSONL_FOLDER").tar"'), "the tar file is unpacked at the container path");
});

test("test_disk_check_reads_the_state_folder_copy_at_its_container_path", () => {
    // Scenario: the disk check gets the state folder copy that sits at the container path, so ../../.claude/... lands on the memory copy.
    // read the disk check stage
    const diskCheckText = readDiskCheckStageText();
    // the --state argument is the compare folder plus the container state path
    assert.ok(diskCheckText.includes('--state "$COMPARE_FOLDER$STATE_FOLDER"'), "the state argument keeps the container path");
});
