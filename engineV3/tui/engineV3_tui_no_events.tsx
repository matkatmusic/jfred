// The terminal UI screen for a project that has no file events.

import { Box, Text } from "ink";

export function NoEventsScreen(props: { terminalRows: number }) {
    return (
        <Box flexDirection="column" height={props.terminalRows}>
            <Text wrap="truncate">jfred file history viewer</Text>
            <Text wrap="truncate">This project has no file events.</Text>
        </Box>
    );
}
