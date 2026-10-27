import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/reconstruction_cli_args.ts";

// A transcript path is required; without one, parseArgs reports usage.
test("test_parse_args_requires_a_transcript_path", () => {
    assert.throws(() => parseArgs(["--verbose"]), /usage/);
});

// parseArgs reads the path, an optional --target, and the view flags.
test("test_parse_args_reads_path_target_and_flags", () => {
    const options = parseArgs(["t.jsonl", "--target", "/a/b.py", "--diff"]);
    assert.equal(options.jsonlPath, "t.jsonl");
    assert.equal(options.target?.toString(), "/a/b.py");
    assert.equal(options.diff, true);
    assert.equal(options.verbose, false);
});

// parseArgs reads all four item-46 path-override flags, each landing as a typed domain value; the positional transcript path is still found (flag values are never mistaken for it).
test("test_parse_args_extracts_path_override_flags", () => {
    // Step: parse an argv carrying every override flag plus the positional transcript path.
    const options = parseArgs([
        "--file-history-loc", "/data/file-history",
        "--cwd", "/now/project",
        "--repo", "/now/repo",
        "--base-commit", "abc1234",
        "t.jsonl",
    ]);
    // Step: the positional path survives the flag extraction untouched.
    assert.equal(options.jsonlPath, "t.jsonl");
    // Step: each flag value is hydrated into its domain type (Path/Uuid), not left a bare string.
    assert.equal(options.fileHistoryRoot?.toString(), "/data/file-history");
    assert.equal(options.projectCwd?.toString(), "/now/project");
    assert.equal(options.repoDir?.toString(), "/now/repo");
    assert.equal(options.baseCommit?.toString(), "abc1234");
});

// The --fhsLoc alias alone populates fileHistoryRoot (mirror of the --target/--file alias pattern).
test("test_parse_args_accepts_fhs_alias", () => {
    // Step: parse an argv where the file-history root arrives ONLY via the alias spelling.
    const options = parseArgs(["t.jsonl", "--fhsLoc", "/data/file-history"]);
    // Step: the alias lands in the same fileHistoryRoot field, hydrated as a Path.
    assert.equal(options.fileHistoryRoot?.toString(), "/data/file-history");
});

test("test_parse_args_collects_multiple_positional_transcripts", () => {
    // Scenario (spec S4b): every non-flag argument is a transcript path — multiple conversation-log folders arrive as multiple positionals.
    const options = parseArgs(["a.jsonl", "b.jsonl", "--diff"]);
    // Test verification: both positionals collected, first one keeps the legacy field.
    assert.deepEqual(options.jsonlPaths, ["a.jsonl", "b.jsonl"]);
    assert.equal(options.jsonlPath, "a.jsonl");
});

test("test_parse_args_single_positional_keeps_legacy_fields", () => {
    // Scenario (spec S4b): a single-transcript invocation is byte-for-byte the legacy shape.
    const options = parseArgs(["t.jsonl", "--verbose"]);
    assert.deepEqual(options.jsonlPaths, ["t.jsonl"]);
    assert.equal(options.jsonlPath, "t.jsonl");
});

test("test_parse_until_revision_flag", () => {
    // Scenario (task 193): --until-revision lands as a typed Path, and the ordinal defaults to the FIRST revision when --nth is absent.
    const options = parseArgs(["t.jsonl", "--until-revision", "/a/b.py"]);
    assert.equal(options.untilRevision?.toString(), "/a/b.py");
    assert.equal(options.untilNth, 1);
});

test("test_parse_until_nth_flag", () => {
    // Scenario (task 193): --nth picks a later revision ordinal for the bound.
    const options = parseArgs(["t.jsonl", "--until-revision", "/a/b.py", "--nth", "4"]);
    assert.equal(options.untilNth, 4);
});

test("test_parse_nth_requires_until_revision", () => {
    // Scenario (task 193): an ordinal without a bound target is meaningless — usage error.
    assert.throws(() => parseArgs(["t.jsonl", "--nth", "2"]), /usage/);
});

test("test_parse_nth_rejects_non_integer", () => {
    // Scenario (task 193): a non-integer ordinal is a usage error, mirroring --step.
    assert.throws(() => parseArgs(["t.jsonl", "--until-revision", "/a/b.py", "--nth", "x"]), /usage/);
});

test("test_parse_nth_rejects_below_one", () => {
    // Scenario (task 193): ordinals are 1-based; zero is a usage error.
    assert.throws(() => parseArgs(["t.jsonl", "--until-revision", "/a/b.py", "--nth", "0"]), /usage/);
});

test("test_parse_no_pre_baseline_flag", () => {
    // Scenario (task 223): the CLI equivalent of the viewer's "No" to the pre-baseline question — absent keeps today's "Yes"; present declines reconstructing anything before the seed.
    assert.equal(parseArgs(["t.jsonl"]).preBaseline, true);
    assert.equal(parseArgs(["t.jsonl", "--no-pre-baseline"]).preBaseline, false);
});
