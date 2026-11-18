// The terminal size of the root component: the size at the start, then the size of every resize event of the output stream.

import { useStdout } from "ink";
import { useEffect, useState } from "react";

export type TerminalSize = { terminalRows: number; terminalColumns: number };

export function useTerminalSize(startSize: TerminalSize): TerminalSize {
    const { stdout } = useStdout();
    const [terminalSize, setTerminalSize] = useState(startSize);
    useEffect(() => {
        function readSizeAgain(): void {
            setTerminalSize({ terminalRows: stdout.rows, terminalColumns: stdout.columns });
        }
        stdout.on("resize", readSizeAgain);
        return () => {
            stdout.off("resize", readSizeAgain);
        };
    }, [stdout]);
    return terminalSize;
}
