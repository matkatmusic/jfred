// Removes both flag and value so the positional transcript-path scan never mistakes a value for it.
export function extractValueFlag(
  argv: string[],
  flag: string,
): { value: string | undefined; rest: string[] } {
  const at = argv.indexOf(flag);
  if (at < 0) {
    return { value: undefined, rest: argv };
  }
  const value = argv[at + 1];
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const isFlagOrValue = index === at || index === at + 1;
    if (!isFlagOrValue) {
      rest.push(argv[index]);
    }
  }
  return { value, rest };
}

// Both DAGs are the bare default: they turn on only when no selector or content-view flag was given.
export function computeGraphFlags(
  rest: string[],
  branch: string | undefined,
  surviving: boolean,
  listBranches: boolean,
  verbose: boolean,
  diff: boolean,
): { convo: boolean; file: boolean } {
  const convo = rest.includes("--graphConvo");
  const file = rest.includes("--graphFile");
  const explicit = convo || file;
  if (explicit) {
    return { convo, file };
  }
  const hasOtherIntent = surviving || listBranches || branch !== undefined || verbose || diff;
  if (hasOtherIntent) {
    return { convo: false, file: false };
  }
  return { convo: true, file: true };
}
