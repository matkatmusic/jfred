// The consent state of the terminal UI: which question to ask, and what a script stop does.

import type { Path } from "../../src/structures/domain.ts";
import { ScriptAction } from "../../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3_replay_reverse_events.ts";

export type ConsentAnswers = {
    runScripts: boolean | undefined;
    runModifyingScriptsAutomatically: boolean | undefined;
};

export type ConsentQuestion = {
    answerKey: keyof ConsentAnswers;
    questionText: string;
};

export type StoppedWalk = {
    file: Path;
    eventType: FileEventType;
    source: string | null;
};

export type ScriptCounts = { mayWrite: number; readOnly: number };

export function getNextConsentQuestion(answers: ConsentAnswers, scriptCounts: ScriptCounts): ConsentQuestion | undefined {
    const totalScriptRuns = scriptCounts.mayWrite + scriptCounts.readOnly;
    if (totalScriptRuns === 0) {
        return undefined;
    }
    if (answers.runScripts === undefined) {
        const questionText = `${totalScriptRuns} script runs were found (${scriptCounts.mayWrite} may write files, ${scriptCounts.readOnly} only read). Run scripts in the docker container? (y/n)`;
        return { answerKey: "runScripts", questionText };
    }
    if (answers.runScripts === true) {
        if (scriptCounts.mayWrite > 0) {
            if (answers.runModifyingScriptsAutomatically === undefined) {
                const questionText = `Run the ${scriptCounts.mayWrite} scripts that may write automatically at each script stop? (y/n)`;
                return { answerKey: "runModifyingScriptsAutomatically", questionText };
            }
        }
    }
    return undefined;
}

export function decideScriptAction(answers: ConsentAnswers, stop: StoppedWalk): ScriptAction {
    if (answers.runScripts !== true) {
        return ScriptAction.Refuse;
    }
    if (stop.eventType !== FileEventType.ScriptMayWrite) {
        return ScriptAction.Refuse;
    }
    if (answers.runModifyingScriptsAutomatically === true) {
        return ScriptAction.RunNow;
    }
    return ScriptAction.WaitForKey;
}

export function chooseFileForPlayKey(cursorFile: Path, selectedFiles: Path[]): Path {
    return cursorFile;
}
