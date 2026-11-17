// The command-line loop of step mode: one command per line in, one JSON line per step out.
import { Path } from "../src/structures/domain.ts";
import { InverseStepOutcome, StepCommand } from "../src/structures/vocabulary.ts";
import { type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { type FileStep, type FileStepResult } from "./engineV3_file_step.ts";
import { stepFileAndWriteCommit, type WrittenStepResult } from "./engineV3_file_step_write.ts";
import { listInverseCommits, type InverseCommit } from "./engineV3_inverse_repo.ts";
import { runReplayCommand } from "./engineV3_step_replay_command.ts";
import type { StepReplayContext } from "./engineV3_step_replay_context.ts";

export type StepCliSession = { repoFolder: Path; fileName: string; relativeFile: string; events: FileEvent[]; step: FileStep; replay?: StepReplayContext };

const STEP_COMMAND_BY_LINE: Record<string, StepCommand> = {
    f: StepCommand.Forward,
    forward: StepCommand.Forward,
    b: StepCommand.Backward,
    backward: StepCommand.Backward,
    q: StepCommand.Quit,
    quit: StepCommand.Quit,
    r: StepCommand.Replay,
    replay: StepCommand.Replay,
};

export function parseStepCommand(line: string): StepCommand {
    if (!Object.hasOwn(STEP_COMMAND_BY_LINE, line)) {
        throw new Error(`parseStepCommand: "${line}" is not a step command`);
    }
    return STEP_COMMAND_BY_LINE[line]!;
}

export function formatStepLine(stepNumber: number, relativeFile: string, written: WrittenStepResult): string {
    const result = written.result;
    let position: number | null = null;
    let commit: string | null = null;
    let instant: string | null = null;
    if (result.writtenState !== undefined) {
        position = result.writtenState.position;
        commit = written.tipCommit.commitHash.toString();
        instant = result.writtenState.state.event.instant?.toISOString() ?? null;
    }
    let source: string | null = null;
    if (result.source !== undefined) {
        source = `${result.source.filePath}:${result.source.lineNumber}`;
    }
    return JSON.stringify({
        step: stepNumber,
        file: relativeFile,
        outcome: result.outcome,
        engine: result.engine ?? null,
        position,
        commit,
        instant,
        eventType: result.eventType ?? null,
        source,
        changedLabels: result.changedLabels,
    });
}

export type BackwardStepResult = { outcome: InverseStepOutcome; position: number; storedCommit: InverseCommit | undefined };

export function moveBackwardInPositionHistory(positionHistory: number[], repoFolder: Path, fileName: string): BackwardStepResult {
    let outcome = InverseStepOutcome.NoNewerChange;
    if (positionHistory.length > 1) {
        positionHistory.pop();
        outcome = InverseStepOutcome.MovedBack;
    }
    const position = positionHistory[positionHistory.length - 1]!;
    const storedCommits = listInverseCommits(repoFolder, fileName, false);
    const storedCommit = storedCommits.find((candidateCommit) => candidateCommit.position === position);
    return { outcome, position, storedCommit };
}

export async function runStepCommands(commandLines: AsyncIterable<string>, session: StepCliSession): Promise<void> {
    const positionHistory: number[] = [session.step.lastWrittenPosition];
    let stepNumber = 0;
    let lastResult: FileStepResult | undefined;
    for await (const line of commandLines) {
        const command = parseStepCommand(line);
        if (command === StepCommand.Quit) {
            return;
        }
        stepNumber += 1;
        if (command === StepCommand.Forward) {
            const nextEvent = session.events[session.step.nextEventIndex];
            let nextSource: string | null = null;
            if (nextEvent?.source !== undefined) {
                nextSource = `${nextEvent.source.filePath}:${nextEvent.source.lineNumber}`;
            }
            console.log(JSON.stringify({
                begin: stepNumber,
                fromPosition: session.step.lastWrittenPosition,
                nextEventIndex: session.step.nextEventIndex,
                nextEventType: nextEvent?.type ?? null,
                nextSource,
            }));
            const written = stepFileAndWriteCommit(session.repoFolder, session.fileName, session.step, undefined);
            console.log(formatStepLine(stepNumber, session.relativeFile, written));
            lastResult = written.result;
            if (written.result.writtenState !== undefined) {
                positionHistory.push(written.result.writtenState.position);
            }
        }
        if (command === StepCommand.Backward) {
            // let outcome = InverseStepOutcome.NoNewerChange;
            // if (positionHistory.length > 1) {
            //     positionHistory.pop();
            //     outcome = InverseStepOutcome.MovedBack;
            // }
            // const position = positionHistory[positionHistory.length - 1]!;
            // const storedCommits = listInverseCommits(session.repoFolder, session.fileName, false);
            // const storedCommit = storedCommits.find((candidateCommit) => candidateCommit.position === position)!;
            // console.log(JSON.stringify({ step: stepNumber, outcome, position, commit: storedCommit.commitHash.toString() }));
            const { outcome, position, storedCommit } = moveBackwardInPositionHistory(positionHistory, session.repoFolder, session.fileName);
            console.log(JSON.stringify({ step: stepNumber, outcome, position, commit: storedCommit!.commitHash.toString() }));
            lastResult = undefined;
        }
        if (command === StepCommand.Replay) {
            const replayed = await runReplayCommand(session, lastResult, stepNumber);
            console.log(replayed.line);
            positionHistory.push(...replayed.positions);
            lastResult = undefined;
        }
    }
}
