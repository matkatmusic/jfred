export const meta = {
  name: 'comment-sweep-293',
  description: 'Hook-driven verbose-comment sweep: one trip+fix agent per file, verification after every wave of 20',
}

const REPO = '/Users/matkatmusicllc/Desktop/claude code src/RevEng/.claude/worktrees/comment-sweep'
const MODEL = 'claude-opus-4-6[1m]'
const ARGS = typeof args === 'string' ? JSON.parse(args) : args
const DIRS = ARGS.dirs ?? []
const EXCLUDE = ARGS.exclude ?? []
const MAX_WAVES = ARGS.maxWaves ?? Infinity

const DISCOVER_SCHEMA = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string' } } },
  required: ['files'],
}

const discoverBrief = `In the repo at ${REPO} (cd there first), build the comment-sweep
work list. Run: git ls-files '*.ts' '*.js' -- ${DIRS.map((d) => `'${d}'`).join(' ')}
Drop these exact paths: ${EXCLUDE.join(', ') || '(none)'}
The directory restriction is INTENTIONAL: only files under the listed
directories may appear in your answer, even if that means 1 file or none.
Do not widen the scan to the rest of the repo for any reason.
Then, using a single bun script, keep only files containing either (a) 2+
consecutive lines whose trimmed text starts with // or (b) one //-comment line
with more than 20 words after the slashes. Count each file's number of 2+
consecutive-// runs and sort descending by that count. Return the sorted
repo-relative paths as {files: [...]}. Read no file contents into your reply;
do all scanning in the script. Modify nothing.`

const SWEEP_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['clean', 'swept', 'partial'] },
    protectedResidue: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['file', 'line', 'reason'],
      },
    },
    flaggedRemaining: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'integer' } },
        required: ['file', 'line'],
      },
    },
  },
  required: ['files', 'status', 'protectedResidue', 'flaggedRemaining'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    revertedFiles: { type: 'array', items: { type: 'string' } },
    typecheckPassed: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['revertedFiles', 'typecheckPassed', 'notes'],
}

const RULES = `1. DELETE any comment that restates what the next line already says
   ("// increment i"), that is stale/wrong, that is a section banner
   ("// ---- helpers ----"), or that is a JSDoc block whose tags only repeat
   the TypeScript signature ("@param path {Path}").
2. KEEP AT MOST ONE comment per block, rewritten as a single sentence UNDER 20
   WORDS stating WHY the code exists, not what it does.
3. NEVER DELETE: "ponytail:", TODO, FIXME, HACK, "@ts-", "eslint-", "#!"
   shebangs, license headers, or a comment recording a non-obvious invariant /
   bug workaround (keep and shorten, don't cut).
4. CHANGE ZERO CODE. No renames, reordering, code-line formatting, or import
   changes. Comment lines only.
5. Do not delete "//" inside string literals or URLs.
6. NEVER delete or shorten a comment that explains a regular expression — any
   comment next to a RegExp literal stays VERBATIM, even if the hook flags it.

Your own edits re-trigger the hook; iterate until its report is empty OR every
remaining flagged line is protected by rule 3 or 6 — then stop and list those
lines in protectedResidue with a one-phrase reason each. Do not run tests or
typecheck. Soft time budget: 10 minutes — if you cannot finish, stop and return
status "partial" with the unfixed hook-flagged lines in flaggedRemaining.
Return status "swept" when the report is empty (protectedResidue allowed).`

const briefFor = (item) => (typeof item === 'string' ? tripBrief(item) : targetedBrief(item))

const tripBrief = (file) => `You are sweeping comments in EXACTLY ONE file: ${file}
Repo root (cd here first): ${REPO}

STEP 1 — TRIP. Read the file, then use Edit to append a single trailing blank
line. A PostToolUse hook ("Reflowing wrapped comments") fires on every edit: it
auto-concatenates multi-line plain-prose // blocks, then returns a BLOCKING
report listing line numbers whose comment still exceeds 20 words. If the report
is empty, you are done — return status "clean" immediately. Leave the trailing
blank line in place.

STEP 2 — FIX. The hook is the authority on what needs fixing. For each flagged
line, apply this rule:
${RULES}
Return [the file's path] as "files"; residue/remaining entries name the file.`

const targetedBrief = (entries) => `You are fixing over-long comments in EXACTLY
these files (repo root, cd here first: ${REPO}):
${entries.map((e) => `${e.filename} — lines ${e.lineNumbersPerFile.join(', ')}`).join('\n')}

A reflow script already collapsed every multi-line // block to a single line.
Each listed 1-based line number holds a //-comment exceeding 20 words.
For each file: read it, locate every flagged comment, then fix each one by
this rule:
${RULES}

Deleting comment lines shifts later line numbers — locate ALL flagged comments
in a file before editing it, or work bottom-up. A validation hook fires on
every edit and reports any comment still over 20 words; treat its report
exactly as described above. Do not add blank lines; edit only the flagged
comments. Touch no file outside the list. Return every listed filename in
"files".`

const verifyBrief = (files) => `You are verifying a comment-only sweep wave in
the repo at: ${REPO} (cd here first). Wave files:
${files.join('\n')}

CHECK 1 — comment-lines-only diff. Run:
  git diff -U0 -- <the wave files> | rg '^[+-]' | rg -v '^(\\+\\+\\+|---)' | rg -v '^[+-]\\s*(//|/\\*|\\*)' | rg -v '^[+-]\\s*$'
It must print nothing (blank/whitespace-only trip lines are exempt). For any
file whose hunks show real code changes, revert it with: git checkout -- <file>
and record it in revertedFiles.

CHECK 2 — typecheck. Run: npx tsc --noEmit
If it fails and you reverted files in check 1, run it once more. If it still
fails, set typecheckPassed=false and put the first errors in notes.
Do not edit any file. Do not revert files that only have comment/blank-line
changes.`

const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

const labelOf = (item) => {
  const names = namesOf(item)
  return `sweep:${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}`
}

const sweepOne = (item, phase) =>
  agent(briefFor(item), { label: labelOf(item), phase, model: MODEL, effort: 'low', schema: SWEEP_SCHEMA })

async function runWave(items, waveName) {
  const results = []
  for (const batch of chunk(items, 4)) {
    const r = await parallel(batch.map((it) => () => sweepOne(it, waveName)))
    results.push(...r.filter(Boolean))
  }
  const verify = await agent(verifyBrief(items.flatMap(namesOf)), {
    label: `verify:${waveName}`, phase: waveName, model: MODEL, effort: 'low', schema: VERIFY_SCHEMA,
  })
  return { results, verify }
}

let fileList = ARGS.files
if (!fileList) {
  log('Discovering candidate files')
  const discovered = await agent(discoverBrief, {
    label: 'discover', phase: 'Discover', model: MODEL, effort: 'low', schema: DISCOVER_SCHEMA,
  })
  fileList = discovered.files
}
const nameOf = (item) => (typeof item === 'string' ? item : item.filename)
const namesOf = (item) => (Array.isArray(item) ? item.map((e) => e.filename) : [nameOf(item)])

const packByLines = (entries, target) => {
  const packs = []
  let cur = [], count = 0
  for (const e of entries) {
    cur.push(e)
    count += e.lineNumbersPerFile.length
    if (count >= target) { packs.push(cur); cur = []; count = 0 }
  }
  if (cur.length) packs.push(cur)
  return packs
}
const FILES = fileList.filter((item) => {
  const f = nameOf(item)
  return (
    !EXCLUDE.includes(f) &&
    (!DIRS.length || DIRS.some((dir) => f.startsWith(dir.replace(/\/$/, '') + '/')))
  )
})
log(`${FILES.length} candidate files`)

const targeted = FILES.every((it) => typeof it !== 'string' && Array.isArray(it.lineNumbersPerFile))
const WORK = targeted ? packByLines(FILES, 10) : FILES
log(`${FILES.length} entries → ${WORK.length} work chunks`)

const waves = chunk(WORK, 20).slice(0, MAX_WAVES)
const swept = [], residue = [], requeue = [], reverted = []

const collect = (r, requeueInto) => {
  const bad = new Set(r.flaggedRemaining.map((x) => x.file))
  if (r.status === 'partial' && !bad.size) r.files.forEach((f) => bad.add(f))
  for (const f of r.files) (bad.has(f) ? requeueInto : swept).push(f)
  residue.push(...r.protectedResidue)
}

for (let i = 0; i < waves.length; i++) {
  const name = `Wave ${i + 1}/${waves.length}`
  log(`${name}: ${waves[i].length} chunks`)
  const { results, verify } = await runWave(waves[i], name)
  for (const r of results) collect(r, requeue)
  reverted.push(...(verify?.revertedFiles ?? []))
  if (verify && !verify.typecheckPassed) {
    return { abortedAtWave: i + 1, reason: verify.notes, swept, requeue, residue, reverted }
  }
  log(`${name} done: ${requeue.length} total re-queued, ${reverted.length} reverted`)
}

if (requeue.length) {
  log(`Requeue pass: ${requeue.length} files`)
  const stillFlagged = []
  const { results, verify } = await runWave([...new Set(requeue)], 'Requeue')
  for (const r of results) collect(r, stillFlagged)
  reverted.push(...(verify?.revertedFiles ?? []))
  return { swept, unswept: stillFlagged, residue, reverted, typecheckPassed: verify?.typecheckPassed ?? false }
}

return { swept, unswept: [], residue, reverted, typecheckPassed: true }
