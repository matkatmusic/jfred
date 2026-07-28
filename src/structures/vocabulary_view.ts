// The VIEW layer's own vocabulary: choices a rendered page makes, which no transcript record carries. Split from structures/vocabulary.ts (the WIRE vocabulary) when that file reached the repo's 250-line cap — same rule as §2 of plans/coding-requirements.md, one canonical home per enum and no re-export shim, applied to a second file rather than a second spelling.

// Which git stamp places a commit on the Layer 1 axis (task 282): a rebase collapses committer time onto one instant while author time stays days apart, so the reading is chosen per view — never a boolean. The values ARE the `time=` query-param and the toggle buttons' id suffixes: one spelling across wire, URL and DOM.
export enum CommitTimeSource {
    committer = "committer",
    author = "author",
}

// Which kind of source folder Layer 1's picker is scanning (task 296): a folder of session transcripts, or a file-history snapshot store. The values ARE the `kind=` query-param spelling.
export enum SourceKind {
    jsonl = "jsonl",
    fileHistory = "filehistory",
}

