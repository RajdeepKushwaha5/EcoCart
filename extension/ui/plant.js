// A plant that grows one stage for every greener action: an old device handed over, or a lower-footprint choice.
// Loaded as a plain script by the content scripts, the popup and the dashboard, so it defines globals.

const PLANT_STAGES = ["Seed", "Sprout", "Seedling", "Young plant", "Budding", "In bloom"];
const PLANT_MAX_STAGE = PLANT_STAGES.length - 1;
const PLANT_STEM_HEIGHTS = [0, 16, 32, 48, 60, 66];
const PLANT_SOIL_Y = 104;
const PLANT_X = 60;

function plantStage(actions) {
  const stage = Math.min(actions, PLANT_MAX_STAGE);
  const remaining = PLANT_MAX_STAGE - stage;
  return {
    stage,
    name: PLANT_STAGES[stage],
    next: remaining === 0
      ? "Fully grown. Every greener action still counts."
      : `${remaining} more greener ${remaining === 1 ? "action" : "actions"} to full bloom`,
  };
}

function plantLeaf(x, y, angle, size) {
  return `<path d="M0 0 Q ${size / 2} ${-size / 2} ${size} 0 Q ${size / 2} ${size / 3} 0 0 Z"
    transform="translate(${x} ${y}) rotate(${angle})" fill="var(--accent)" />`;
}

function plantFlower(x, y) {
  const petals = Array.from({ length: 6 }, (_, i) =>
    `<ellipse cx="${x}" cy="${y - 9}" rx="5" ry="9" transform="rotate(${i * 60} ${x} ${y})" fill="var(--bloom, var(--accent))" />`,
  ).join("");
  return `${petals}<circle cx="${x}" cy="${y}" r="5" fill="var(--bg)" stroke="var(--accent)" stroke-width="2" />`;
}

// Returns SVG markup built only from fixed shapes, so it is safe to assign to innerHTML.
function plantSvg(stage) {
  const top = PLANT_SOIL_Y - PLANT_STEM_HEIGHTS[stage];
  const parts = [];

  if (stage === 0) {
    parts.push(`<ellipse cx="${PLANT_X}" cy="${PLANT_SOIL_Y - 3}" rx="6" ry="4" fill="none" stroke="var(--accent)" stroke-width="2" />`);
  } else {
    parts.push(`<path d="M${PLANT_X} ${PLANT_SOIL_Y} C ${PLANT_X - 4} ${PLANT_SOIL_Y - 20}, ${PLANT_X + 4} ${top + 20}, ${PLANT_X} ${top}"
      fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" />`);
  }
  if (stage === 1) parts.push(plantLeaf(PLANT_X, top, -150, 12), plantLeaf(PLANT_X, top, -30, 12));
  if (stage >= 2) parts.push(plantLeaf(PLANT_X, PLANT_SOIL_Y - 18, -160, 20), plantLeaf(PLANT_X, PLANT_SOIL_Y - 24, -20, 20));
  if (stage >= 3) parts.push(plantLeaf(PLANT_X, PLANT_SOIL_Y - 38, -150, 18), plantLeaf(PLANT_X, PLANT_SOIL_Y - 44, -30, 18));
  if (stage === 4) parts.push(`<circle cx="${PLANT_X}" cy="${top - 4}" r="6" fill="var(--accent)" />`);
  if (stage >= 5) parts.push(plantFlower(PLANT_X, top - 6));

  return `<svg viewBox="0 0 120 140" role="img" aria-label="${PLANT_STAGES[stage]}">
    <g class="plant-growth">${parts.join("\n")}</g>
    <path d="M30 ${PLANT_SOIL_Y} H90 L84 134 Q83 138 79 138 H41 Q37 138 36 134 Z" fill="var(--pot, var(--raise))" stroke="var(--pot-line, var(--line))" stroke-width="2" />
    <line x1="30" y1="${PLANT_SOIL_Y}" x2="90" y2="${PLANT_SOIL_Y}" stroke="var(--soil, var(--muted))" stroke-width="3" stroke-linecap="round" />
  </svg>`;
}
