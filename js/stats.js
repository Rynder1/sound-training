// Scores live only in this browser. Storage can be blocked (private mode), so every access is guarded.
const KEY = "sound-training-stats-v1";

function empty() {
	// levels holds the Adaptive level per skill (see difficulty.js).
	return { byType: {}, bestStreak: 0, difficulty: "easy", levels: {} };
}

export function loadStats() {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY));
		return saved && saved.byType ? { ...empty(), ...saved } : empty();
	} catch {
		return empty();
	}
}

export function saveStats(stats) {
	try {
		localStorage.setItem(KEY, JSON.stringify(stats));
	} catch {
		// Nothing to do: the game still works, scores just are not remembered.
	}
}

// credit is 0 to 1, so "correct" is a points total that can hold part marks.
export function recordAnswer(stats, type, credit, streak) {
	const entry = stats.byType[type] || { played: 0, correct: 0 };
	entry.played += 1;
	entry.correct += credit;
	stats.byType[type] = entry;
	stats.bestStreak = Math.max(stats.bestStreak, streak);
	saveStats(stats);
}

export function resetStats(stats) {
	const fresh = { ...empty(), difficulty: stats.difficulty };
	saveStats(fresh);
	return fresh;
}
