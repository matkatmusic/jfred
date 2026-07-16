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

// findConversationBranches names the surviving branch (tip E) and the rewound branch (tip C,
// rewindPoint B), and does not invent others.
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

// selectBranchRecords keeps the tip's ancestor chain plus uuid-less meta, dropping the sibling
// branch (selecting tip C keeps B,C + meta and drops D,E).
test("test_select_branch_records_keeps_tip_chain_and_meta", () => {
    const kept = selectBranchRecords(buildRewindRecords(), new Uuid("C"));
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["B", "C"]);
    assert.ok(kept.some((r) => r.type === RecordType.mode));
});

// selectLiveBranch is selectBranchRecords for the surviving head (keeps B,D,E + meta).
test("test_select_live_branch_keeps_surviving_chain", () => {
    const kept = selectLiveBranch(buildRewindRecords());
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["B", "D", "E"]);
});

// With no last-prompt head, selectLiveBranch returns all records unchanged (the fallback).
test("test_select_live_branch_returns_all_when_no_head", () => {
    const records = buildRewindRecords().filter((r) => r.type !== RecordType.lastPrompt);
    assert.equal(selectLiveBranch(records).length, records.length);
});

// A file-history-snapshot record in parsed/wire shape; getFileHistorySnapshot hydrates messageId and
// backupTime. `backups` gives a non-null backupFileName per path (default null = a refresh snapshot).
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

// The surviving branch is the one that produced the on-disk files (Wa), even though Hc is the final
// conversation head — because the final rewind was conversation-only (the snapshot is unchanged).
test("test_find_conversation_branches_survives_working_tree_not_final_head", () => {
    const branches = findConversationBranches(buildConversationRewindRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "Wa");
    // Hc is not surviving (it is the file-less conversation head).
    assert.ok(!branches.some((b) => b.isSurviving && b.tip.toString() === "Hc"));
});

// selectLiveBranch follows the same decision: it keeps Wa's chain (R, Wa), not Hc.
test("test_select_live_branch_follows_working_tree_after_conversation_rewind", () => {
    const kept = selectLiveBranch(buildConversationRewindRecords());
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["R", "Wa"]);
});

// R = root checkpoint; Wb = the write turn's head (working tree gets a real backup: file@2 with a
// backupFileName); Hr = a `code` rewind back to R that only reads — its refresh snapshot re-versions
// the SAME on-disk content (file@3) with a NULL backupFileName.
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

// The surviving branch is the one that produced the on-disk files (Wb), even though Hr is the final
// conversation head — a code restore with no post-edit re-versions the SAME content with a null
// backupFileName, so the version bump must NOT move the working-tree owner.
test("test_find_conversation_branches_survives_restored_code_not_final_refresh", () => {
    const branches = findConversationBranches(buildCodeRestoreNoPostEditRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "Wb");
    assert.ok(!branches.some((b) => b.isSurviving && b.tip.toString() === "Hr"));
});

// selectLiveBranch follows the same decision: it keeps Wb's chain (R, Wb), not Hr.
test("test_select_live_branch_follows_restored_code_after_code_rewind", () => {
    const kept = selectLiveBranch(buildCodeRestoreNoPostEditRecords());
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["R", "Wb"]);
});

// R  = root checkpoint.
// Wa = the write turn's head; its snapshot gives file.py a REAL backup (v2, non-null backupFileName).
// Hc = a CONVERSATION-ONLY rewind back to R that only reads. Because the rewind did NOT restore the
//      working tree, file.py stays on disk and is re-snapshotted with the SAME version (still v2) and
//      the SAME real backupFileName — no churn (this is what distinguishes a conv-only rewind from a
//      code restore, whose refresh would bump the version with a null backupFileName).
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

// Scenario: a conversation-only rewind with no post-edit keeps the surviving branch on the write turn
// (Wa), not the final read head (Hc), even when the post-rewind snapshot repeats a REAL (non-null)
// backupFileName at an unbumped version.
// Steps:
//   - Build the records: a write turn Wa (file.py@2 with a real backup) and a conversation-only
//     rewind Hc to root that only reads and re-snapshots file.py@2 with the SAME real backup.
//   - Enumerate the conversation branches.
//   - The surviving branch's tip must be Wa (the branch that produced the on-disk file), because the
//     repeated identical content signature must NOT move the working-tree owner to Hc.
//   - No surviving branch may be tipped at Hc (it is the file-less final conversation head).
test("test_find_conversation_branches_survives_working_tree_when_conv_only_refresh_repeats_real_backup", () => {
    const branches = findConversationBranches(buildConversationOnlyRewindRealBackupRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "Wa");
    assert.ok(!branches.some((b) => b.isSurviving && b.tip.toString() === "Hc"));
});

// R  = root checkpoint.
// Wa = the FIRST (abandoned) write turn — the "add"; its snapshot gives file.py a REAL backup
//      (v2, "backup-A@v2").
// Wb = a CODE rewind back to R, then a post-restore REWRITE — the "multiply". The code restore first
//      emits a refresh snapshot (v3, NULL backupFileName: content wiped back toward root); the rewrite
//      then writes new content, producing a NEW real backup at a NEW version ("backup-A@v4"). The
//      path-hash component ("backup-A") is identical to Wa's backup — only the @v4 suffix differs from
//      the carried-forward @v2 — so the content signature CHANGES and the working-tree owner must
//      ADVANCE from Wa to Wb. (Contrast buildCodeRestoreNoPostEditRecords, whose refresh leaves the
//      signature unchanged so the owner stays put.)
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

// Scenario: a code restore followed by a post-rewind rewrite ADVANCES the surviving branch from the
// abandoned first write (Wa) to the rewrite (Wb) — the complement of the no-post-edit case, where the
// owner must NOT move.
// Steps:
//   - Build the records: an abandoned write turn Wa (file.py@2, real backup @v2), then a code rewind to
//     root whose refresh re-versions file.py@3 with a NULL backup, then a rewrite Wb re-backing file.py
//     up at @v4 with a NEW real backup.
//   - Enumerate the conversation branches.
//   - The surviving branch's tip must be Wb (the rewrite), because the new real backup @v4 differs from
//     the carried-forward @v2 and so moves the working-tree owner forward.
//   - No surviving branch may be tipped at Wa (it is the abandoned pre-restore write).
test("test_find_conversation_branches_advances_owner_to_post_restore_rewrite", () => {
    const branches = findConversationBranches(buildCodeRestoreThenRewriteRecords());
    const surviving = branches.find((b) => b.isSurviving)!;
    assert.equal(surviving.tip.toString(), "Wb");
    assert.ok(!branches.some((b) => b.isSurviving && b.tip.toString() === "Wa"));
});

