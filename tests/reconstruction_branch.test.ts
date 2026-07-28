import { test } from "node:test";
import assert from "node:assert/strict";
import {
    findConversationBranches,
    selectBranchRecords,
    selectLiveBranch,
} from "../src/reconstruction_branch.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { rec, lastPrompt } from "./reconstruction-branch-test-helpers.ts";

// B = rewind checkpoint; C = abandoned child; D->E = surviving; plus a uuid-less meta record.
function buildRewindRecords(): TranscriptRecord[] {
    return [
        rec(RecordType.user, "B", null),
        rec(RecordType.assistant, "C", "B"),     // abandoned branch tip
        lastPrompt("C"),                          // earlier head (abandoned)
        rec(RecordType.user, "D", "B"),
        rec(RecordType.assistant, "E", "D"),     // surviving branch tip
        { type: RecordType.mode } as TranscriptRecord, // uuid-less meta — always kept
        lastPrompt("E"),                          // final head (surviving)
    ];
}

test("test_find_conversation_branches_identifies_surviving_and_rewound", () => {
    const branches = findConversationBranches(buildRewindRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "E");
    assert.equal(surviving.rewindPoint, undefined);
    const rewound = branches.filter((b) => !b.isSurviving);
    assert.equal(rewound.length, 1);
    assert.equal(rewound[0]!.tip.toString(), "C");
    assert.equal(rewound[0]!.rewindPoint!.toString(), "B");
});

test("test_select_branch_records_keeps_tip_chain_and_meta", () => {
    const kept = selectBranchRecords(buildRewindRecords(), new Uuid("C"));
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["B", "C"]);
    assert.ok(kept.some((r) => r.type === RecordType.mode));
});

test("test_select_live_branch_keeps_surviving_chain", () => {
    const kept = selectLiveBranch(buildRewindRecords());
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["B", "D", "E"]);
});

// With no last-prompt head there is nothing to select from, so everything is kept.
test("test_select_live_branch_returns_all_when_no_head", () => {
    const records = buildRewindRecords().filter((r) => r.type !== RecordType.lastPrompt);
    assert.equal(selectLiveBranch(records).length, records.length);
});

// A null backupFileName (the `backups` default) is what marks a refresh snapshot.
function snapshotRec(
    messageId: string,
    tracked: Record<string, number>,
    backups: Record<string, string> = {},
): TranscriptRecord {
    const trackedFileBackups: Record<string, unknown> = {};
    for (const [path, version] of Object.entries(tracked)) {
        trackedFileBackups[path] = {
            backupFileName: backups[path] ?? null,
            version,
            backupTime: "2026-01-01T00:00:00.000Z",
        };
    }
    return {
        type: RecordType.fileHistorySnapshot,
        messageId,
        snapshot: { messageId, timestamp: "2026-01-01T00:00:00.000Z", trackedFileBackups },
        isSnapshotUpdate: true,
    } as unknown as TranscriptRecord;
}

// R = root checkpoint; Wa = the write turn's head (working tree changes to file@2 here);
// Hc = a conversation-only rewind back to R that writes nothing (working tree stays file@2).
function buildConversationRewindRecords(): TranscriptRecord[] {
    return [
        rec(RecordType.user, "R", null),
        rec(RecordType.assistant, "Wa", "R"),       // the write turn's tail
        lastPrompt("Wa"),                            // head: the code branch
        snapshotRec("Wa", { "file.py": 2 }),         // working tree changed -> file@2
        rec(RecordType.user, "Hc", "R"),             // conversation-only rewind to root: a new Hello
        lastPrompt("Hc"),                            // final head, but it wrote nothing
        snapshotRec("Hc", { "file.py": 2 }),         // working tree UNCHANGED (still file@2)
    ];
}

// The surviving branch is the one that produced the on-disk files, not the final conversation head.
test("test_find_conversation_branches_survives_working_tree_not_final_head", () => {
    const branches = findConversationBranches(buildConversationRewindRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "Wa");
    assert.ok(!branches.some((b) => b.isSurviving && b.tip.toString() === "Hc"));
});

test("test_select_live_branch_follows_working_tree_after_conversation_rewind", () => {
    const kept = selectLiveBranch(buildConversationRewindRecords());
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["R", "Wa"]);
});

// A read-only `code` rewind re-versions the SAME on-disk content with a NULL backupFileName.
function buildCodeRestoreNoPostEditRecords(): TranscriptRecord[] {
    return [
        rec(RecordType.user, "R", null),
        rec(RecordType.assistant, "Wb", "R"),                          // the write turn's tail
        lastPrompt("Wb"),                                              // head: the code (write) branch
        snapshotRec("Wb", { "file.py": 2 }, { "file.py": "backup-A@v2" }), // real content backup
        rec(RecordType.user, "Hr", "R"),                              // code rewind to root: a read-only turn
        lastPrompt("Hr"),                                              // final head, but it wrote nothing
        snapshotRec("Hr", { "file.py": 3 }),                          // refresh: version bumped, content unchanged (null bfn)
    ];
}

// A version bump with a null backupFileName is not new content, so it must not move the owner.
test("test_find_conversation_branches_survives_restored_code_not_final_refresh", () => {
    const branches = findConversationBranches(buildCodeRestoreNoPostEditRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "Wb");
    assert.ok(!branches.some((b) => b.isSurviving && b.tip.toString() === "Hr"));
});

test("test_select_live_branch_follows_restored_code_after_code_rewind", () => {
    const kept = selectLiveBranch(buildCodeRestoreNoPostEditRecords());
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["R", "Wb"]);
});

// A conv-only rewind leaves the working tree alone, so the re-snapshot repeats the SAME version and
// the SAME real backup — unlike a code restore, which bumps the version with a null backup.
function buildConversationOnlyRewindRealBackupRecords(): TranscriptRecord[] {
    return [
        rec(RecordType.user, "R", null),
        rec(RecordType.assistant, "Wa", "R"),                              // the write turn's tail
        lastPrompt("Wa"),                                                  // head: the write branch
        snapshotRec("Wa", { "file.py": 2 }, { "file.py": "backup-A@v2" }), // real content backup
        rec(RecordType.user, "Hc", "R"),                                   // conv-only rewind to root: a read-only turn
        lastPrompt("Hc"),                                                  // final head, but it wrote nothing
        snapshotRec("Hc", { "file.py": 2 }, { "file.py": "backup-A@v2" }), // SAME version, SAME real backup
    ];
}

// A repeated identical content signature must NOT move the working-tree owner to the read head.
test("test_find_conversation_branches_survives_working_tree_when_conv_only_refresh_repeats_real_backup", () => {
    const branches = findConversationBranches(buildConversationOnlyRewindRealBackupRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "Wa");
    assert.ok(!branches.some((b) => b.isSurviving && b.tip.toString() === "Hc"));
});

// The rewrite's backup shares Wa's path-hash and differs only in the @v4 suffix, so the content
// signature changes and the working-tree owner must advance.
function buildCodeRestoreThenRewriteRecords(): TranscriptRecord[] {
    return [
        rec(RecordType.user, "R", null),
        rec(RecordType.assistant, "Wa", "R"),                              // first write turn (add)
        lastPrompt("Wa"),                                                  // head: the abandoned write branch
        snapshotRec("Wa", { "file.py": 2 }, { "file.py": "backup-A@v2" }), // add head: real backup @v2
        rec(RecordType.user, "Wb", "R"),                                   // code rewind to root, then rewrite
        lastPrompt("Wb"),                                                  // head: the surviving (rewrite) branch
        snapshotRec("Wb", { "file.py": 3 }),                               // code-restore refresh: v3, null bfn
        snapshotRec("Wb", { "file.py": 4 }, { "file.py": "backup-A@v4" }), // rewrite: NEW real backup @v4
    ];
}

// The complement of the no-post-edit case: a real post-restore rewrite DOES move the owner.
test("test_find_conversation_branches_advances_owner_to_post_restore_rewrite", () => {
    const branches = findConversationBranches(buildCodeRestoreThenRewriteRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "Wb");
    assert.ok(!branches.some((b) => b.isSurviving && b.tip.toString() === "Wa"));
});

