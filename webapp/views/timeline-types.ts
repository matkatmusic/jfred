// Wire strings mirror src/structures/vocabulary.ts; the webapp cannot import TS enums.

export const COMMIT_NODE_KIND = "commit";
export const USER_TURN_NODE_KIND = "user-turn";
export const AGENT_TURN_NODE_KIND = "agent-turn";
export const SESSION_END_NODE_KIND = "session-end";
export const TOOL_CALL_NODE_KIND = "tool-call";
export const USER_ROLE = "user";
export const EDIT_EVENT_KIND = "edit";
export const COMMIT_OPERATION_KIND = "commit";
// The two EventKind wire strings the Files tree reads: a delete dims the row, a rename badges it.
export const DELETE_EVENT_KIND = "delete";
export const RENAME_EVENT_KIND = "rename";
