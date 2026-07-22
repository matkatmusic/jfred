#!/bin/sh
# Task 165: restore the executed captures' nested scenario repos. Each git-baseline
# scenario's .git is published as repo.git.tar because committing a nested .git turns
# the whole scenario dir into a gitlink and silently drops its contents (the
# demo-bundle trap). Runs as npm pretest, so both `npm test` locally and in CI see
# the repos; idempotent — an already-extracted .git is left alone.
for tarFile in scenarios/executed/*/repo.git.tar; do
    [ -e "$tarFile" ] || continue
    scenarioDir=$(dirname "$tarFile")
    [ -d "$scenarioDir/.git" ] || tar -xf "$tarFile" -C "$scenarioDir"
done
