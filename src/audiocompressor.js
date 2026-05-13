export default class AudioCompressor {
    #input = null;
    #output = null;
    #audioCtx = null;
    #limiter = null;
    #analyser = null;

    constructor(audioCtx) {
        this.#audioCtx = audioCtx;
        this.#input = this.#audioCtx.createGain();

        let lastNode = this.#input;
        [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384].forEach(freq => {
            lastNode = this.#bandEqualizer(lastNode, freq);
            this[`band${freq < 1000 ? freq : (freq / 1024) + 'k'}`] = lastNode;
        });

        this.#limiter = this.#audioCtx.createDynamicsCompressor();
        this.#limiter.threshold.setValueAtTime(-20, this.#audioCtx.currentTime);
        this.#limiter.ratio.setValueAtTime(20, this.#audioCtx.currentTime);
        this.#limiter.attack.setValueAtTime(0.000, this.#audioCtx.currentTime);
        this.#limiter.release.setValueAtTime(0.25, this.#audioCtx.currentTime);
        
        this.#analyser = this.#audioCtx.createAnalyser();
        this.#analyser.fftSize = 256; 
        this.#analyser.smoothingTimeConstant = 0.3;

        this.#output = this.#audioCtx.createGain();

        lastNode.connect(this.#limiter);
        this.#limiter.connect(this.#analyser);
        this.#analyser.connect(this.#output);
        this.#output.connect(this.#audioCtx.destination);
    }
	

    get analyser() { return this.#analyser; }
    get input() { return this.#input; }


    #bandEqualizer(from, frequency) {
        const filter = this.#audioCtx.createBiquadFilter();
        filter.frequency.setTargetAtTime(frequency, 0, 0.0001);
        filter.type = "peaking";
        filter.gain.setTargetAtTime(0, 0, 0.0001);
        filter.Q.setTargetAtTime(1.0, 0, 0.0001);
        from.connect(filter);
        return filter;
    }

}