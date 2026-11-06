// Deals every card once, in random order, before reshuffling, so questions do not repeat early.
export function shuffle(list) {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export class Deck {
	constructor(makeCards) {
		this.makeCards = makeCards;
		this.cards = [];
	}

	// avoid(card) marks cards to skip if another is left, such as the song just played.
	draw(avoid = () => false) {
		if (!this.cards.length) this.cards = shuffle(this.makeCards());
		const index = this.cards.findIndex((card) => !avoid(card));
		return this.cards.splice(Math.max(index, 0), 1)[0];
	}
}
