// The screen layout of the root component: legend, header, file rows, details box, key footer.

import type { ReactNode } from "react";
import { Box, Text } from "ink";
import { Barbershop } from "./engineV3_tui_barbershop.tsx";
// import type { JumpSpeed } from "../../src/structures/vocabulary.ts";
import type { HotKeyRow } from "./engineV3_tui_hotkeys_rows.ts";
import { InfoBox, LegendBox, type FooterEntry } from "./engineV3_tui_footer.tsx";
import { HotKeysBox } from "./engineV3_tui_hotkeys_box.tsx";
import type { KeyBoxSettings } from "./engineV3_tui_keymap.ts";
import { buildBarLegendLines } from "./engineV3_tui_legend.ts";

const BAR_WIDTH = 30;

export type AppLayoutProps = {
    terminalRows: number;
    terminalColumns: number;
    headerText: string;
    isCacheLoading: boolean;
    rows: ReactNode;
    // detailEntries: FooterEntry[];
    markerBox: ReactNode;
    infoLines: FooterEntry[][];
    // keyEntries: FooterEntry[];
    keyBox: KeyBoxSettings;
    // speed: JumpSpeed;
    hotKeyRows: HotKeyRow[];
    drawer: ReactNode;
    rowsHeight: number | undefined;
};

export function AppLayout(props: AppLayoutProps) {
    return (
        <Box flexDirection="column" height={props.terminalRows}>
            <LegendBox lines={buildBarLegendLines()} columns={props.terminalColumns} />
            {props.markerBox}
            <Box gap={1}>
                <Text wrap="truncate">{props.headerText}</Text>
                {props.isCacheLoading && <Barbershop width={BAR_WIDTH} />}
            </Box>
            <Box flexDirection="column" flexGrow={1} height={props.rowsHeight}>{props.rows}</Box>
            {/* <Box height={1}><Text wrap="truncate-end">{infoRowText}</Text></Box> */}
            {/* <MenuRow keymap={props.keymap} speed={speed} /> */}
            {/* {props.markerBox} */}
            {/* <DetailsBox entries={props.detailEntries} columns={props.terminalColumns} /> */}
            {/* <InfoBox lines={props.infoLines} columns={props.terminalColumns} /> */}
            {props.drawer === null && <InfoBox lines={props.infoLines} columns={props.terminalColumns} />}
            {/* <KeyFooter entries={props.keyEntries} columns={props.terminalColumns} /> */}
            {/* <HotKeysBox keyBox={props.keyBox} speed={props.speed} columns={props.terminalColumns} /> */}
            {props.drawer}
            <HotKeysBox rows={props.hotKeyRows} keyBox={props.keyBox} columns={props.terminalColumns} />
        </Box>
    );
}
