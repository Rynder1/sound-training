import { CLEAN_MIX } from "./mixer.js";
import { amountAt } from "./difficulty.js";
import { shuffle } from "./deck.js";

export const TYPES = {
	present: "Which instruments are playing?",
	loud: "Which instrument is too loud?",
	problem: "What is wrong with this mix?",
};

//#region Amounts

// Amounts at levels 0 to 3 (Easy, Medium, Hard, Expert); see difficulty.js.
const BOOST_DB = [9, 6, 3, 1.5];

const round = (n, step = 0.1) => Math.round(n / step) * step;
const num = (n) => String(Number(n.toFixed(1)));
const between = (low, high) => low * Math.pow(high / low, Math.random());

// Each problem: what the player hears, its amounts, and when it fits a song.
const PROBLEMS = [
	{ id: "vocalQuiet", label: "Vocal too quiet", anchors: [-14, -9, -5, -3],
		fits: (track) => Boolean(vocalOf(track)),
		build: (amt, track) => ({ stemDb: { [vocalOf(track).id]: amt } }),
		size: (amt) => `${num(-amt)} dB down`,
		explain: (amt) => `The vocal was turned down by ${num(-amt)} dB.` },
	{ id: "muddy", label: "Muddy (too much low-mid)", anchors: [12, 8, 5, 3],
		build: (amt) => ({ lowMidDb: amt, lowMidHz: round(between(200, 500), 10) }),
		size: (amt) => `+${num(amt)} dB`,
		explain: (amt, pick, mix) => `The low-mids around ${mix.lowMidHz} Hz were boosted by ${num(amt)} dB.` },
	{ id: "thin", label: "Thin (missing low end)", anchors: [400, 250, 160, 110],
		build: (amt) => ({ highpassHz: round(amt, 10) }),
		size: (amt) => `${round(amt, 10)} Hz cut`,
		explain: (amt, pick, mix) => `Everything below about ${mix.highpassHz} Hz was cut with a high-pass filter.` },
	{ id: "harsh", label: "Harsh (too much top end)", anchors: [12, 8, 5, 3],
		build: (amt) => ({ highShelfDb: amt, highShelfHz: round(between(2500, 5000), 100) }),
		size: (amt) => `+${num(amt)} dB`,
		explain: (amt, pick, mix) => `The highs above ${num(mix.highShelfHz / 1000)} kHz were boosted by ${num(amt)} dB.` },
	{ id: "reverb", label: "Too much reverb", anchors: [1, 0.55, 0.3, 0.18],
		build: (amt) => ({ reverb: amt }),
		size: (amt) => `${Math.round(amt * 100)}% send`,
		explain: (amt) => `A large reverb was added to the whole mix, at a ${Math.round(amt * 100)}% send.` },
	{ id: "panned", label: "Lopsided (something panned hard)", anchors: [1, 0.8, 0.6, 0.45],
		fits: (track) => centreStems(track).length > 0,
		build: (amt, track, pick) => ({ pan: { [pick.id]: amt * (Math.random() < 0.5 ? -1 : 1) } }),
		pick: (track) => randomItem(centreStems(track)),
		size: (amt) => `${Math.round(amt * 100)}% off centre`,
		explain: (amt, pick, mix) => `${pick.label}: panned ${Math.round(amt * 100)}% ${mix.pan[pick.id] < 0 ? "left" : "right"} instead of the centre.` },
	{ id: "clipping", label: "Distorted (clipping)", anchors: [14, 9, 5, 3],
		build: (amt) => ({ clipDb: amt }),
		size: (amt) => `${num(amt)} dB of peaks`,
		explain: (amt) => `The loudest ${num(amt)} dB of peaks were clipped off.` },
];

export const PROBLEM_LABELS = PROBLEMS.map(({ id, label }) => ({ id, label }));

//#endregion

//#region Helpers

function randomItem(list) {
	return list[Math.floor(Math.random() * list.length)];
}

function vocalOf(track) {
	return track.stems.find((s) => s.vocal);
}

function centreStems(track) {
	return track.stems.filter((s) => s.pan === 0 && !s.sparse);
}

function withMix(changes) {
	return { ...CLEAN_MIX, ...changes };
}

//#endregion

//#region Cards and skills

// One card per distinct question setup; app.js deals them from a shuffled deck.
export function cardsFor(type, tracks) {
	if (type === "present") return tracks.map((track) => ({ track }));
	if (type === "loud") {
		return tracks.flatMap((track) => track.stems.filter((s) => !s.sparse).map((stem) => ({ track, stem })));
	}
	return tracks.flatMap((track) => PROBLEMS.filter((p) => !p.fits || p.fits(track)).map((problem) => ({ track, problem })));
}

// Adaptive mode keeps one level per skill: each mix problem is its own skill.
export function skillKey(type, card) {
	return type === "problem" ? `problem.${card.problem.id}` : type;
}

// What a level means in sound, for the scores list.
export function describeSkills() {
	return [
		{ key: "present", label: TYPES.present, size: (level) => `level ${num(level)} of 3` },
		{ key: "loud", label: "Too loud", size: (level) => `+${num(amountAt(BOOST_DB, level))} dB` },
		...PROBLEMS.map((p) => ({ key: `problem.${p.id}`, label: p.label, size: (level) => p.size(amountAt(p.anchors, level)) })),
	];
}

//#endregion

//#region Questions

export function makeQuestion(type, card, level) {
	if (type === "present") return presentQuestion(card.track, level);
	if (type === "loud") return loudQuestion(card.track, card.stem, level);
	return problemQuestion(card.track, card.problem, level);
}

function presentQuestion(track, level) {
	const count = 1 + Math.floor(Math.random() * (track.stems.length - 2));
	const muted = shuffle(track.stems).slice(0, count).map((s) => s.id);
	const playing = track.stems.filter((s) => !muted.includes(s.id));
	const stemDb = {};
	// From Hard upwards one playing instrument is also turned down, so it is easy to miss.
	if (level >= 1.5) stemDb[randomItem(playing).id] = -(level - 1) * 8;
	return {
		type: "present",
		multi: true,
		hint: level < 0.5 ? `${playing.length} of ${track.stems.length} instruments are playing.` : "",
		options: track.stems.map(({ id, label }) => ({ id, label })),
		answer: playing.map((s) => s.id),
		mix: withMix({ muted, stemDb }),
		explain: () => `Playing: ${playing.map((s) => s.label).join(", ")}.`,
	};
}

function loudQuestion(track, target, level) {
	const db = amountAt(BOOST_DB, level);
	return {
		type: "loud",
		multi: false,
		hint: "",
		options: track.stems.map(({ id, label }) => ({ id, label })),
		answer: [target.id],
		mix: withMix({ stemDb: { [target.id]: db } }),
		explain: () => `${target.label}: turned up by ${num(db)} dB.`,
	};
}

function problemQuestion(track, problem, level) {
	const amount = amountAt(problem.anchors, level);
	const pick = problem.pick ? problem.pick(track) : null;
	const mix = withMix(problem.build(amount, track, pick));
	return {
		type: "problem",
		multi: false,
		hint: "",
		options: PROBLEM_LABELS.filter((o) => o.id !== "vocalQuiet" || vocalOf(track)),
		answer: [problem.id],
		mix,
		explain: () => problem.explain(amount, pick, mix),
	};
}

//#endregion

// "Which are playing" earns a share for each instrument judged right: ticked if playing, unticked if muted.
// The other types are right or wrong. Returns credit from 0 to 1.
export function scoreAnswer(question, chosen) {
	if (!question.multi) {
		const right = chosen.length === 1 && chosen[0] === question.answer[0] ? 1 : 0;
		return { credit: right, right, of: 1 };
	}
	const right = question.options.filter((o) => question.answer.includes(o.id) === chosen.includes(o.id)).length;
	const of = question.options.length;
	return { credit: right / of, right, of };
}
