// Live stem mixer: every question is the same stems with different mix settings.
// Signal path: stems -> gain -> pan -> bus (+ reverb send) -> trim -> high-pass -> low-mid EQ
//   -> high shelf -> clipper -> safety limiter -> speakers.

// Songs are level-matched on loudness (RMS), capped so the clean mix keeps headroom for boosts.
const TARGET_RMS = 0.12;
const PEAK_CAP = 0.55;
const RAMP = 0.03;

export const CLEAN_MIX = Object.freeze({
	stemDb: {},
	muted: [],
	pan: {},
	reverb: 0,
	lowMidDb: 0,
	lowMidHz: 300,
	highShelfDb: 0,
	highShelfHz: 3500,
	highpassHz: 0,
	clipDb: 0,
});

function dbToGain(db) {
	return Math.pow(10, db / 20);
}

function makeImpulse(ctx, seconds) {
	const length = Math.floor(ctx.sampleRate * seconds);
	const ir = ctx.createBuffer(2, length, ctx.sampleRate);
	for (let ch = 0; ch < 2; ch++) {
		const data = ir.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
		}
	}
	return ir;
}

function clipCurve(threshold) {
	const curve = new Float32Array(2049);
	for (let i = 0; i < curve.length; i++) {
		const x = (i / (curve.length - 1)) * 2 - 1;
		curve[i] = Math.max(-threshold, Math.min(threshold, x));
	}
	return curve;
}

export class Mixer {
	constructor() {
		this.ctx = null;
		this.cache = new Map();
		this.track = null;
		this.channels = [];
		this.sources = [];
		this.playing = false;
		this.mix = CLEAN_MIX;
		this.loadSeq = 0;
	}

	// iOS only allows audio to start inside a tap handler, so this must run from one.
	unlock() {
		if (!this.ctx) {
			const Ctx = window.AudioContext || window.webkitAudioContext;
			this.ctx = new Ctx();
			this.buildMaster();
		}
		return this.ctx.resume();
	}

	buildMaster() {
		const ctx = this.ctx;
		this.bus = ctx.createGain();
		this.reverbSend = ctx.createGain();
		this.reverbSend.gain.value = 0;
		this.convolver = ctx.createConvolver();
		this.convolver.buffer = makeImpulse(ctx, 2.8);
		this.trim = ctx.createGain();
		this.highpass = ctx.createBiquadFilter();
		this.highpass.type = "highpass";
		this.highpass.frequency.value = 10;
		this.lowMid = ctx.createBiquadFilter();
		this.lowMid.type = "peaking";
		this.lowMid.frequency.value = 300;
		this.lowMid.Q.value = 1;
		this.highShelf = ctx.createBiquadFilter();
		this.highShelf.type = "highshelf";
		this.highShelf.frequency.value = 3500;
		this.clipper = ctx.createWaveShaper();
		this.clipper.curve = clipCurve(1);
		this.limiter = ctx.createDynamicsCompressor();
		this.limiter.threshold.value = -3;
		this.limiter.knee.value = 0;
		this.limiter.ratio.value = 20;
		this.limiter.attack.value = 0.003;
		this.limiter.release.value = 0.1;

		this.bus.connect(this.trim);
		this.bus.connect(this.reverbSend);
		this.reverbSend.connect(this.convolver);
		this.convolver.connect(this.trim);
		this.trim.connect(this.highpass);
		this.highpass.connect(this.lowMid);
		this.lowMid.connect(this.highShelf);
		this.highShelf.connect(this.clipper);
		this.clipper.connect(this.limiter);
		this.limiter.connect(ctx.destination);
	}

	async load(track) {
		const seq = ++this.loadSeq;
		if (!this.cache.has(track.id)) {
			const buffers = await Promise.all(track.stems.map(async (stem) => {
				const res = await fetch(`audio/${track.id}/${stem.id}.mp3`);
				if (!res.ok) throw new Error(`Could not load ${track.id}/${stem.id}`);
				const bytes = await res.arrayBuffer();
				return new Promise((resolve, reject) => this.ctx.decodeAudioData(bytes, resolve, reject));
			}));
			const { peak, rms } = sumLevels(buffers);
			const trim = Math.min(TARGET_RMS / rms, PEAK_CAP / peak);
			this.cache.set(track.id, { buffers, trim, cleanPeak: peak * trim });
		}
		if (seq !== this.loadSeq) return;
		this.stop();
		const { buffers, trim, cleanPeak } = this.cache.get(track.id);
		this.channels.forEach((ch) => ch.pan.disconnect());
		this.track = track;
		this.cleanPeak = cleanPeak;
		this.trim.gain.value = trim;
		this.channels = track.stems.map((stem, i) => {
			const gain = this.ctx.createGain();
			const pan = this.ctx.createStereoPanner();
			gain.connect(pan);
			pan.connect(this.bus);
			return { stem, buffer: buffers[i], gain, pan };
		});
		this.apply(CLEAN_MIX, true);
	}

	play() {
		this.stop();
		const when = this.ctx.currentTime + 0.05;
		this.sources = this.channels.map((ch) => {
			const src = this.ctx.createBufferSource();
			src.buffer = ch.buffer;
			src.loop = true;
			src.connect(ch.gain);
			src.start(when);
			return src;
		});
		this.playing = true;
	}

	stop() {
		this.sources.forEach((src) => {
			src.stop();
			src.disconnect();
		});
		this.sources = [];
		this.playing = false;
	}

	apply(mix, instant = false) {
		this.mix = mix;
		const now = this.ctx.currentTime;
		const set = (param, value) => {
			if (instant) {
				param.cancelScheduledValues(now);
				param.value = value;
			} else {
				param.setTargetAtTime(value, now, RAMP);
			}
		};
		this.channels.forEach(({ stem, gain, pan }) => {
			const muted = mix.muted.includes(stem.id);
			set(gain.gain, muted ? 0 : dbToGain(mix.stemDb[stem.id] || 0));
			set(pan.pan, stem.id in mix.pan ? mix.pan[stem.id] : stem.pan);
		});
		set(this.reverbSend.gain, mix.reverb);
		set(this.highpass.frequency, mix.highpassHz || 10);
		// A filter with 0 dB gain is silent, so the clean mix leaves its frequency alone instead of sweeping it mid-fade.
		if (mix.lowMidDb) this.lowMid.frequency.value = mix.lowMidHz;
		if (mix.highShelfDb) this.highShelf.frequency.value = mix.highShelfHz;
		set(this.lowMid.gain, mix.lowMidDb);
		set(this.highShelf.gain, mix.highShelfDb);
		// A centre-panned mono stem reaches each channel at -3 dB, so that is the clean peak at the clipper.
		this.clipper.curve = clipCurve(mix.clipDb ? this.cleanPeak * Math.SQRT1_2 / dbToGain(mix.clipDb) : 1);
	}
}

function sumLevels(buffers) {
	const length = Math.min(...buffers.map((b) => b.length));
	const data = buffers.map((b) => b.getChannelData(0));
	let peak = 0;
	let energy = 0;
	for (let i = 0; i < length; i++) {
		let sum = 0;
		for (const d of data) sum += d[i];
		peak = Math.max(peak, Math.abs(sum));
		energy += sum * sum;
	}
	return { peak: peak || 1, rms: Math.sqrt(energy / length) || 1 };
}
