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
        this.#limiter.threshold.setValueAtTime(-20, this.#audioCtx.currentTime);
        this.#limiter.ratio.setValueAtTime(20, this.#audioCtx.currentTime);
        this.#limiter.attack.setValueAtTime(0.001, this.#audioCtx.currentTime);
        this.#limiter.release.setValueAtTime(0.25, this.#audioCtx.currentTime);

        this.#analyser = this.#audioCtx.createAnalyser();
        this.#analyser.fftSize = 256;
        this.#analyser.smoothingTimeConstant = 0.4;

        this.#output = this.#audioCtx.createGain();
        this.#output.gain.setValueAtTime(volume, this.#audioCtx.currentTime);

        lastNode.connect(this.#limiter);

        lastNode.connect(this.#reverbNode);
        this.#reverbNode.connect(this.#reverbWet);
        this.#reverbWet.connect(this.#limiter);

        this.#limiter.connect(this.#output);
        this.#output.connect(this.#analyser);
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
        filter.frequency.setTargetAtTime(frequency, 0, 0.0001);
        filter.type = "peaking";
        filter.gain.setTargetAtTime(0, 0, 0.0001);
        filter.Q.setTargetAtTime(1.0, 0, 0.0001);
        from.connect(filter);
        return filter;
    }


    // #generateImpulseResponse(duration, decay) {
    //     const sampleRate = this.#audioCtx.sampleRate;
    //     const length = sampleRate * duration;
    //     const impulse = this.#audioCtx.createBuffer(2, length, sampleRate);
    //     for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    //         const data = impulse.getChannelData(channel);
    //         for (let i = 0; i < length; i++) {
    //             data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    //         }
    //     }
    //     this.#reverbNode.buffer = impulse;
    // }

    #generateImpulseResponse(duration, decay) {
        const sampleRate = this.#audioCtx.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.#audioCtx.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
            const data = impulse.getChannelData(channel);

            // On utilise un simple filtre passe-bas itératif (LPF)
            let lastValue = 0;
            const filterCoef = 0.1; // Plus c'est bas, plus c'est "dark"

            for (let i = 0; i < length; i++) {
                // 1. Génération du bruit blanc
                const whiteNoise = (Math.random() * 2 - 1);

                // 2. Application de l'enveloppe exponentielle
                // On utilise Math.exp pour une décroissance plus naturelle
                const envelope = Math.exp(-i / (sampleRate * (duration / decay)));

                // 3. Filtre rudimentaire pour adoucir les hautes fréquences
                // Ça simule l'absorption des murs
                lastValue = (whiteNoise * filterCoef) + (lastValue * (1 - filterCoef));

                data[i] = lastValue * envelope;
            }
        }
        this.#reverbNode.buffer = impulse;
    }

}