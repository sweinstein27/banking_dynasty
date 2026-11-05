/** Whole gulden as shown to the player: "1,000 fl." A sentence ending on an amount needs no extra full stop. */
export const fl = (n: number) => `${n.toLocaleString("en-US")} fl.`;
