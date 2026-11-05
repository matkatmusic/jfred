// Why a file bubble has no created-at node: the server picks one, the page shows its sentence.

export const CreatedNotTrustedReason = {
  noBirthTime: "noBirthTime",
  birthNotBeforeMtime: "birthNotBeforeMtime",
  birthAfterFirstCommit: "birthAfterFirstCommit",
} as const;
export type CreatedNotTrustedReason = (typeof CreatedNotTrustedReason)[keyof typeof CreatedNotTrustedReason];
