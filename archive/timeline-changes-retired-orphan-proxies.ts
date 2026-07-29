// Archived from webapp/views/timeline-changes.ts (task 121 line-cap trim): the retired pre-engine-stamped-isOrphaned snapshot-proxy checks. The engine now stamps branch membership per record on the wire (message.isOrphaned / toolCall.isOrphaned), copied at node construction — these commented-out bodies are preserved here verbatim.

// old (pre engine-stamped isOrphaned): the per-step snapshot proxy — a step counted orphaned
// when its changeIds resolved only to rewound-branch revisions.
// // A step is orphaned when at least one of its changeIds matches a rewound-branch revision and
// // none matches a surviving one — those are the dimmed, unpickable rows.
// export function checkStepIsOrphaned(step: WireStepSnapshot, revisionIndex: RevisionIndex): boolean {
//     let matchesRewound = false;
//     for (const changeId of step.changeIds) {
//         const revision = revisionIndex.get(changeId);
//         if (revision === undefined) {
//             continue;
//         }
//         if (!revision.isRewound) {
//             return false;
//         }
//         matchesRewound = true;
//     }
//     return matchesRewound;
// }

// old (pre engine-stamped isOrphaned): the snapshot-proxy orphan check — retired alongside
// checkStepIsOrphaned; node.isOrphaned now copies the engine's per-record wire stamp.
// // Orphaned when the turn owns snapshots and EVERY one sits on a rewound branch; a turn with any
// // surviving snapshot — or none at all — stays on the spine.
// function checkTurnIsOrphaned(snapshots: WireStepSnapshot[], revisionIndex: RevisionIndex): boolean {
//     if (snapshots.length === 0) {
//         return false;
//     }
//     return snapshots.every((snapshot) => checkStepIsOrphaned(snapshot, revisionIndex));
// }
