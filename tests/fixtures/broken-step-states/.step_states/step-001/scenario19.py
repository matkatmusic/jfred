# DELIBERATELY MANGLED FIXTURE — do not "fix" this content.
# tests/check_scenario_coverage.test.ts points BROKEN_STEP_STATES here and asserts that no engine step
# reproduces this file, so checkScenario must report a mismatch on scenario19.py. Any content that differs
# from every real s19 reconstruction works; this is intentionally wrong.
def add(a, b):
    return a - b  # wrong operator on purpose
