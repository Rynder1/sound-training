import { TRACKS } from "./tracks.js";
import { Mixer, CLEAN_MIX } from "./mixer.js";
import { TYPES, cardsFor, skillKey, describeSkills, makeQuestion, scoreAnswer } from "./questions.js";
import { loadStats, saveStats, recordAnswer, resetStats } from "./stats.js";
import { questionLevel, updateLevel, skillLevel } from "./difficulty.js";
import { Deck } from "./deck.js";

const $ = (id) => document.getElementById(id);
const points = (n) => String(Math.round(n * 10) / 10);
const mixer = new Mixer();
let stats = loadStats();
let mode = "mixed";
let question = null;
let answered = false;
let roundScore = { right: 0, total: 0, streak: 0 };
let lastTrackId = null;
let questionSeq = 0;
const decks = Object.fromEntries(Object.keys(TYPES).map((type) => [type, new Deck(() => cardsFor(type, TRACKS))]));

//#region Screens

function show(screen) {
	document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== `screen-${screen}`; });
	window.scrollTo(0, 0);
}

function renderStats() {
	const parts = Object.entries(TYPES).map(([type, label]) => {
		const s = stats.byType[type];
		const text = s ? `${points(s.correct)} / ${s.played} (${Math.round((s.correct / s.played) * 100)}%)` : "not played yet";
		return `<li><span>${label}</span><b>${text}</b></li>`;
	});
	let levels = "";
	if (stats.difficulty === "adaptive") {
		const rows = describeSkills().map((s) => `<li><span>${s.label}</span><b>${s.size(skillLevel(stats, s.key))}</b></li>`);
		levels = `<h2>Adaptive levels</h2><p class="small">The size of change each skill is at now. It shrinks as you get answers right, and settles where you get about 3 in 4 right.</p><ul>${rows.join("")}</ul>`;
	}
	$("stats").innerHTML = `<h2>Your scores</h2><ul>${parts.join("")}</ul><p class="small">Best streak: ${stats.bestStreak}</p>${levels}`;
}

function renderCredits() {
	$("credit-list").innerHTML = TRACKS.map((t) => `
		<li>
			<b>${t.title}</b> by ${t.artist}<br>
			Licence: <a href="${t.licenceUrl}" target="_blank" rel="noopener">${t.licence}</a><br>
			Source: <a href="${t.source}" target="_blank" rel="noopener">${t.source}</a><br>
			<span class="small">${t.note}</span>
		</li>`).join("");
}

function openMenu() {
	questionSeq++;
	mixer.stop();
	renderStats();
	document.querySelector(`input[name=difficulty][value=${stats.difficulty}]`).checked = true;
	show("menu");
}

//#endregion

//#region Round

function pickType() {
	if (mode !== "mixed") return mode;
	const types = Object.keys(TYPES);
	return types[Math.floor(Math.random() * types.length)];
}

async function newQuestion() {
	const seq = ++questionSeq;
	answered = false;
	mixer.stop();
	const type = pickType();
	const card = decks[type].draw((c) => c.track.id === lastTrackId);
	const track = card.track;
	lastTrackId = track.id;
	const key = skillKey(type, card);
	question = { ...makeQuestion(type, card, questionLevel(stats, key)), key };

	$("track-name").textContent = `Song: ${track.title}, by ${track.artist}`;
	$("prompt").textContent = TYPES[question.type];
	$("hint").textContent = question.hint || (question.multi ? "Tick all that apply." : "Pick one.");
	$("feedback").hidden = true;
	$("ab").hidden = true;
	$("next").hidden = true;
	$("submit").hidden = false;
	$("submit").disabled = true;
	renderOptions();
	renderScore();

	setPlayButton("Loading…", true);
	try {
		await mixer.load(track);
	} catch (err) {
		if (seq === questionSeq) setPlayButton("Could not load audio. Tap to retry.", false, newQuestion);
		return;
	}
	// A newer question (or leaving the round) started while this one was loading.
	if (seq !== questionSeq) return;
	mixer.apply(question.mix, true);
	mixer.play();
	setPlayButton("Stop", false);
}

function renderOptions() {
	const kind = question.multi ? "checkbox" : "radio";
	$("options").innerHTML = question.options.map((o) => `
		<label class="option" data-id="${o.id}">
			<input type="${kind}" name="answer" value="${o.id}">
			<span>${o.label}</span>
		</label>`).join("");
	$("options").querySelectorAll("input").forEach((input) => {
		input.addEventListener("change", () => {
			$("submit").disabled = answered || (!question.multi && !chosen().length);
		});
	});
	// For "which are playing", ticking nothing is a valid (if unlikely) answer.
	$("submit").disabled = !question.multi;
}

function chosen() {
	return [...$("options").querySelectorAll("input:checked")].map((i) => i.value);
}

function submit() {
	if (answered) return;
	answered = true;
	const picked = chosen();
	const { credit, right, of } = scoreAnswer(question, picked);
	const full = credit === 1;
	roundScore.total += 1;
	roundScore.right += credit;
	// The streak counts full marks only, so a part-right answer ends it.
	roundScore.streak = full ? roundScore.streak + 1 : 0;
	updateLevel(stats, question.key, full);
	recordAnswer(stats, question.type, credit, roundScore.streak);
	renderScore();

	$("options").querySelectorAll(".option").forEach((el) => {
		const id = el.dataset.id;
		const want = question.answer.includes(id);
		const got = picked.includes(id);
		el.querySelector("input").disabled = true;
		if (want) el.classList.add("right");
		if (got && !want) el.classList.add("wrong");
		if (want && !got && question.multi) el.classList.add("missed");
	});

	const fb = $("feedback");
	fb.hidden = false;
	fb.className = `feedback ${full ? "good" : credit > 0 ? "partial" : "bad"}`;
	let verdict = full ? "Correct!" : "Not quite.";
	if (question.multi && !full) {
		verdict = `${right} of ${of} instruments judged right, so ${Math.round(credit * 100)}% of a point.`;
	}
	fb.textContent = `${verdict} ${question.explain()}`;

	$("submit").hidden = true;
	$("ab").hidden = false;
	setAb("problem");
	$("next").hidden = false;
	$("next").focus();
}

function setAb(which) {
	$("ab-problem").setAttribute("aria-pressed", String(which === "problem"));
	$("ab-clean").setAttribute("aria-pressed", String(which === "clean"));
	mixer.apply(which === "problem" ? question.mix : CLEAN_MIX);
	if (!mixer.playing) {
		mixer.play();
		setPlayButton("Stop", false);
	}
}

function renderScore() {
	$("score").textContent = `${points(roundScore.right)} / ${roundScore.total}  ·  streak ${roundScore.streak}`;
}

let playAction = null;
function setPlayButton(label, disabled, action = null) {
	const btn = $("play");
	btn.textContent = label;
	btn.disabled = disabled;
	playAction = action;
}

function togglePlay() {
	if (playAction) return playAction();
	if (mixer.playing) {
		mixer.stop();
		setPlayButton("Play", false);
	} else {
		mixer.play();
		setPlayButton("Stop", false);
	}
}

//#endregion

//#region Wiring

$("start").addEventListener("click", async () => {
	await mixer.unlock();
	openMenu();
});

document.querySelectorAll(".mode").forEach((btn) => {
	btn.addEventListener("click", async () => {
		await mixer.unlock();
		mode = btn.dataset.mode;
		roundScore = { right: 0, total: 0, streak: 0 };
		show("round");
		newQuestion();
	});
});

document.querySelectorAll("input[name=difficulty]").forEach((input) => {
	input.addEventListener("change", () => {
		stats.difficulty = input.value;
		saveStats(stats);
		renderStats();
	});
});

$("reset-stats").addEventListener("click", () => {
	if (!confirm("Reset all saved scores on this device?")) return;
	stats = resetStats(stats);
	renderStats();
});

$("show-credits").addEventListener("click", () => {
	renderCredits();
	show("credits");
});
$("credits-back").addEventListener("click", openMenu);
$("back").addEventListener("click", openMenu);
$("play").addEventListener("click", togglePlay);
$("submit").addEventListener("click", submit);
$("next").addEventListener("click", newQuestion);
$("ab-problem").addEventListener("click", () => setAb("problem"));
$("ab-clean").addEventListener("click", () => setAb("clean"));

//#endregion
