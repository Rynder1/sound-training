// A level runs from 0 (the Easy amount) through 1 (Medium) and 2 (Hard) to 3 (Expert).
// Each question jitters the level so the same song never sounds identical twice.
const FIXED = { easy: 0, medium: 1, hard: 2 };
const FIXED_SPREAD = 0.4;
const MAX_LEVEL = 3;

// Adaptive mode is a weighted staircase: a wrong answer steps back 3 times as far as a right answer
// steps forward, so each level settles where the player gets about 3 in 4 right.
const START_LEVEL = 0.5;
const ADAPTIVE_SPREAD = 0.15;
const STEP_HARDER = 0.15;
const STEP_EASIER = 0.45;

const clamp = (level) => Math.max(0, Math.min(MAX_LEVEL, level));

export function skillLevel(stats, key) {
	return stats.levels[key] ?? START_LEVEL;
}

export function questionLevel(stats, key) {
	const adaptive = stats.difficulty === "adaptive";
	const base = adaptive ? skillLevel(stats, key) : FIXED[stats.difficulty];
	const spread = adaptive ? ADAPTIVE_SPREAD : FIXED_SPREAD;
	return clamp(base + (Math.random() * 2 - 1) * spread);
}

export function updateLevel(stats, key, fullMarks) {
	if (stats.difficulty !== "adaptive") return;
	stats.levels[key] = clamp(skillLevel(stats, key) + (fullMarks ? STEP_HARDER : -STEP_EASIER));
}

// anchors holds the amount at levels 0, 1, 2 and 3; in-between levels are interpolated.
export function amountAt(anchors, level) {
	const i = Math.min(Math.floor(level), anchors.length - 2);
	return anchors[i] + (anchors[i + 1] - anchors[i]) * (level - i);
}
