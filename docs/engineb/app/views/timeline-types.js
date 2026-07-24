// Timeline view-model wire types + node types (split from timeline.ts, task 92).
// Wire-string discriminants mirror src/structures/vocabulary.ts — the webapp is a plain-JS
// browser runtime that cannot import the TS enums; the tests assert equivalence against the real
// enum members.
export const COMMIT_NODE_KIND = "commit";
export const USER_TURN_NODE_KIND = "user-turn";
export const AGENT_TURN_NODE_KIND = "agent-turn";
export const SESSION_END_NODE_KIND = "session-end";
export const TOOL_CALL_NODE_KIND = "tool-call";
export const USER_ROLE = "user";
export const EDIT_EVENT_KIND = "edit";
export const COMMIT_OPERATION_KIND = "commit";
// Item 77: the two EventKind wire strings the Files tree reads (a delete dims the row, a rename
// gives it its origin badge). Mirrored as consts like the kinds above — the webapp cannot import
// the TS enums; tests assert equivalence against the real vocabulary.ts members.
export const DELETE_EVENT_KIND = "delete";
export const RENAME_EVENT_KIND = "rename";
