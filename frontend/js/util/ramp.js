// Sequential ramp for the current theme (night: more fire = lighter; day: more fire = darker).
import { RAMP, RAMP_DAY } from "../config.js";
import { state } from "../state.js";

export const ramp = () => (state.theme === "day" ? RAMP_DAY : RAMP);
