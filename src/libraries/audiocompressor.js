export default class AudioCompressor {
    #input = null;
    #output = null;
    #audioCtx = null;
    #limiter = null;
    #analyser = null;

    #reverbNode = null;
    #reverbWet = null;
    #currentReverbLevel = 0;

    constructor(audioCtx, volume, reverb) {
        this.#audioCtx = audioCtx;
        this.#input = this.#audioCtx.createGain();
        let lastNode = this.#input;
        const frequencies = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
        frequencies.forEach(freq => {
            lastNode = this.#bandEqualizer(lastNode, freq);
            const label = freq < 1000 ? freq : (freq / 1024) + 'k';
            this[`band${label}`] = lastNode;
        });

        this.#currentReverbLevel = reverb;
        this.#reverbNode = this.#audioCtx.createConvolver();
        this.#reverbWet = this.#audioCtx.createGain();
        this.#reverbWet.gain.setValueAtTime(reverb, this.#audioCtx.currentTime);
        this.#generateImpulseResponse(1.5, 2.0);

        this.#limiter = this.#audioCtx.createDynamicsCompressor();
        this.#limiter.threshold.setValueAtTime(-10.0, this.#audioCtx.currentTime);
        this.#limiter.ratio.setValueAtTime(20, this.#audioCtx.currentTime);
        this.#limiter.attack.setValueAtTime(0.001, this.#audioCtx.currentTime);
        this.#limiter.release.setValueAtTime(0.1, this.#audioCtx.currentTime);
        this.#limiter.knee.setValueAtTime(0, this.#audioCtx.currentTime);

        this.#analyser = this.#audioCtx.createAnalyser();
        this.#analyser.fftSize = 256;
        this.#analyser.smoothingTimeConstant = 0.4;

        this.#output = this.#audioCtx.createGain();
        this.#output.gain.setValueAtTime(volume, this.#audioCtx.currentTime);

        lastNode.connect(this.#output);
        this.#output.connect(this.#limiter);
        lastNode.connect(this.#reverbNode);
        this.#reverbNode.connect(this.#reverbWet);
        this.#limiter.connect(this.#analyser);
        this.#reverbWet.connect(this.#analyser);
        this.#analyser.connect(this.#audioCtx.destination);
    }

    get analyser() { return this.#analyser || null; }
    get input() { return this.#input; }
    get reverb() { return this.#currentReverbLevel; }
    set reverb(value) {
        this.#currentReverbLevel = Math.max(0, Math.min(1, value));
        this.#reverbWet.gain.setTargetAtTime(this.#currentReverbLevel, this.#audioCtx.currentTime, 0.1);
    }
    get masterVolume() { return this.#output.gain.value; }
    set masterVolume(value) {
        const linearValue = Math.max(0, Math.min(1, value));
        const logVolume = Math.pow(linearValue, 2);
        this.#output.gain.setTargetAtTime(logVolume, this.#audioCtx.currentTime, 0.01);
    }


    killReverbTail() {
        const now = this.#audioCtx.currentTime;
        this.#reverbWet.gain.cancelScheduledValues(now);
        this.#reverbWet.gain.setValueAtTime(0, now);
    }


    restoreReverb() {
        this.reverb = this.#currentReverbLevel;
    }


    #bandEqualizer(from, frequency) {
        const filter = this.#audioCtx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.setValueAtTime(frequency, this.#audioCtx.currentTime);
        filter.gain.setValueAtTime(0, this.#audioCtx.currentTime);
        filter.Q.setValueAtTime(1.0, this.#audioCtx.currentTime);
        from.connect(filter);
        return filter;
    }


    #generateImpulseResponse(duration, decay) {
        const sampleRate = this.#audioCtx.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.#audioCtx.createBuffer(2, length, sampleRate);
        const preDelayTime = 0.015;
        const preDelaySamples = Math.floor(preDelayTime * sampleRate);
        for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
            const data = impulse.getChannelData(channel);
            let lastValue = 0;
            const channelOffset = channel === 1 ? Math.floor(0.002 * sampleRate) : 0;
            for (let i = 0; i < length; i++) {
                if (i < preDelaySamples) {
                    data[i] = 0;
                    continue;
                }
                const t = (i - preDelaySamples) / sampleRate;
                const envelope = Math.exp(-t * (decay / duration));
                const dampingFactor = Math.max(0.01, 0.2 * Math.exp(-t * 2.5));
                const whiteNoise = (Math.random() * 2 - 1);
                lastValue = (whiteNoise * dampingFactor) + (lastValue * (1 - dampingFactor));
                let sampleValue = lastValue * envelope;
                if (t < 0.04) {
                    if ((i % 123 === 0) || (i % 234 === 0)) {
                        sampleValue += (Math.random() * 2 - 1) * 0.2 * (0.04 - t) / 0.04;
                    }
                }
                if (i + channelOffset < length) data[i + channelOffset] = sampleValue;
                else data[i] = sampleValue;
            }
        }
        this.#reverbNode.buffer = impulse;
    }

}