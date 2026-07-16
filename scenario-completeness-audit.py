#!/usr/bin/env python3
"""Audit .step_states completeness in executed scenarios.

Every scenario step should produce a step-NNN/ capture.  Compares the on-disk
step count against the total step count from the progress file.

Usage:
    python3 scenario-completeness-audit.py            # dry-run report
    python3 scenario-completeness-audit.py --fix      # delete bad .step_states/
"""

import argparse
import re
import shutil
from pathlib import Path

EXECUTED_DIR = Path(__file__).resolve().parent / "plans" / "scenarios" / "executed"
STEP_RE = re.compile(r"^- \[.\] \d+\.")


def findLatestProgress(stem):
    matches = sorted(EXECUTED_DIR.glob(f"{stem}-run-*.txt"))
    return matches[-1] if matches else None


def countStepsInProgress(progress_file):
    return sum(1 for line in progress_file.read_text().splitlines() if STEP_RE.match(line))


def auditOneScenario(scenario_dir):
    ss_dir = scenario_dir / ".step_states"
    if not ss_dir.is_dir():
        return None

    on_disk = sum(1 for x in ss_dir.iterdir() if x.is_dir() and x.name.startswith("step-"))
    stem = scenario_dir.name

    progress = findLatestProgress(stem)
    if not progress:
        return (stem, "INCOMPLETE", "no progress file")

    expected = countStepsInProgress(progress)
    if on_disk != expected:
        return (stem, "MISMATCH", f"expected={expected}, captured={on_disk}")

    return (stem, "OK", "")


def audit():
    findings = []
    for d in sorted(EXECUTED_DIR.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        result = auditOneScenario(d)
        if result:
            findings.append(result)
    return findings


def applyFixes(bad):
    for stem, _, _ in bad:
        target = EXECUTED_DIR / stem / ".step_states"
        shutil.rmtree(target)
        print(f"  DELETED: {target.relative_to(EXECUTED_DIR.parent.parent.parent)}")
    print(f"\nRe-run: python3 run-all-scenarios.py <pane> --skip-existing")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--fix", action="store_true", help="Delete bad .step_states/")
    ap.add_argument("--only", help="Prefix filter, e.g. 's3' matches s3-copy-file")
    args = ap.parse_args()

    findings = audit()
    if args.only:
        prefix = args.only if args.only.endswith("-") else args.only + "-"
        findings = [f for f in findings if f[0].startswith(prefix) or f[0] == args.only]
    ok = [f for f in findings if f[1] == "OK"]
    bad = [f for f in findings if f[1] != "OK"]

    print(f"Audited {len(findings)} scenarios with .step_states/\n")

    if ok:
        print(f"  OK: {len(ok)}")
    for stem, status, detail in bad:
        print(f"  {status}: {stem}  ({detail})")

    if not bad:
        print("\nAll clean.")
        return

    print(f"\n{len(bad)} scenario(s) need re-run.", end="")
    if not args.fix:
        print(" Pass --fix to delete their .step_states/.")
        return

    print()
    applyFixes(bad)


if __name__ == "__main__":
    main()
