// RETIRED 2026-07-02: moved to src/reconstruction_sidecar_reader.ts. Kept per user direction.
//
// // Multi-session reader resolving backups across merged sessions.
//
// import { existsSync, readFileSync } from "node:fs";
// import { join } from "node:path";
// import type { TranscriptRecord } from "../src/structures/envelope.ts";
// import type { Uuid } from "../src/structures/domain.ts";
// import type { BackupReader } from "../src/reconstruction_sidecar.ts";
// import { getDefaultFileHistoryRoot } from "../src/reconstruction_sidecar_reader.ts";
//
// // The distinct session ids across the merged records, in first-seen order. A multi-session scenario carries
// // several; each session's backups live under its OWN file-history dir, so the reader must know all of them.
// export function sessionIdsOf(records: TranscriptRecord[]): Uuid[] {
//     const seen = new Set<string>();
//     const ids: Uuid[] = [];
//     for (const record of records) {
//         const sessionId = (record as { sessionId?: Uuid }).sessionId;
//         if (sessionId && !seen.has(sessionId.toString())) {
//             seen.add(sessionId.toString());
//             ids.push(sessionId);
//         }
//     }
//     return ids;
// }
//
// // The on-disk file-history reader spanning every merged session's dir: a referenced backup lives under
// // whichever session took it, so try each session in order and read the first that exists (falling back to
// // the first session's path so a genuinely-missing backup throws the same ENOENT as the single-session
// // reader). undefined when the records carry no session id (no backups to read).
// export function buildSidecarReader(records: TranscriptRecord[]): BackupReader | undefined {
//     const sessionIds = sessionIdsOf(records);
//     if (sessionIds.length === 0) {
//         return undefined;
//     }
//     const root = getDefaultFileHistoryRoot().toString();
//     return (backupFileName, sessionId) => {
//         const name = backupFileName.toString();
//         // The engine passes the snapshot's OWNING session: across merged sessions the same `@vN` blob name
//         // recurs with different content, so we MUST read the owner's copy. Fall back to a first-existing
//         // search only when the owner is unknown (single-session or a pre-sessionId caller).
//         const owner = sessionId ?? sessionIds.find((id) => existsSync(join(root, id.toString(), name)));
//         return readFileSync(join(root, (owner ?? sessionIds[0]!).toString(), name), "utf8");
//     };
// }


