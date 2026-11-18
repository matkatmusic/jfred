import { Box, Text, useAnimation } from "ink";

export type BarbershopCellColor = "green" | "black";

const BARBERSHOP_STRIPE_PERIOD = 4;
const BARBERSHOP_GREEN_CELLS_PER_PERIOD = 2;
const BARBERSHOP_FRAME_INTERVAL_MILLISECONDS = 100;

export function listBarbershopCells(width: number, frame: number): BarbershopCellColor[] {
    const cellColors: BarbershopCellColor[] = [];
    for (let index = 0; index < width; index++) {
        const stripePosition = (index + frame) % BARBERSHOP_STRIPE_PERIOD;
        const cellColor: BarbershopCellColor = stripePosition < BARBERSHOP_GREEN_CELLS_PER_PERIOD ? "green" : "black";
        cellColors.push(cellColor);
    }
    return cellColors;
}

export function Barbershop(props: { width: number }) {
    const { frame } = useAnimation({ interval: BARBERSHOP_FRAME_INTERVAL_MILLISECONDS });
    const cellColors = listBarbershopCells(props.width, frame);
    return (
        <Box width={props.width}>
            {cellColors.map((cellColor, index) => (
                <Text key={index} backgroundColor={cellColor}>
                    {" "}
                </Text>
            ))}
        </Box>
    );
}
