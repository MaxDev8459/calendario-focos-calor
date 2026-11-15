// Colour legend (M12): numbers always sit next to the colours.
import { RAMP } from "../config.js";
import { fmtInt } from "../util/format.js";

export function legendHTML({ min, max, label, ticks }) {
  const grad = `linear-gradient(90deg, ${RAMP.join(", ")})`;
  const tickRow = ticks
    ? `<div class="legend-ticks mono" aria-hidden="true">${ticks.map((t) => `<span>${typeof t === "number" ? fmtInt(t) : t}</span>`).join("")}</div>`
    : "";
  return `<div class="legend">
    <span class="legend-min mono">${min}</span>
    <span class="legend-ramp" style="background:${grad}" aria-hidden="true"></span>
    <span class="legend-max mono">${max}</span>
    <span class="legend-label label">${label}</span>
    ${tickRow}
  </div>`;
}

// Stepped legend for discrete bins: one swatch per bin with its range.
export function stepLegendHTML(cuts, colors, { label, unit = "" } = {}) {
  const ranges = colors.map((c, i) => {
    const lo = i === 0 ? 0 : cuts[i - 1];
    const hi = cuts[i];
    const txt = i === 0 ? `<${fmtInt(hi)}` : hi == null ? `${fmtInt(lo)}+` : `${fmtInt(lo)}–${fmtInt(hi)}`;
    return `<li><i style="background:${c}" aria-hidden="true"></i><span class="mono">${txt}${unit}</span></li>`;
  });
  return `<div class="step-legend">${label ? `<span class="label">${label}</span>` : ""}<ul>${ranges.join("")}</ul></div>`;
}
