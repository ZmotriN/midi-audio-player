class WebAudioFontPlayer {

    #audioCtx = null;
    #preset = null;

    #envelopes = [];
    #afterTime = 0.05;
    #nearZero = 0.000001;


    constructor(audioCtx, preset) {
        this.#audioCtx = audioCtx;
        this.#preset = preset;
        this.#preset.zones.map(zone => this.#adjustZone(zone));
    }


    queueWaveTable(when, pitch, duration, volume, slides) {
        if(this.#audioCtx.state === 'suspended') this.#audioCtx.resume().catch(() => { });

        const vol = this.#limitVolume(volume);
        const zone = this.#findZone(pitch);
        if (!zone?.buffer) return null;

        const baseDetune = zone.originalPitch - 100.0 * zone.coarseTune - zone.fineTune;
        const playbackRate = Math.pow(2, (100.0 * pitch - baseDetune) / 1200.0);
        const startWhen = Math.max(when, this.#audioCtx.currentTime);
        let waveDuration = duration + this.#afterTime;

        const loop = zone.loopStart >= 1 && zone.loopStart < zone.loopEnd;
        if (!loop) waveDuration = Math.min(waveDuration, zone.buffer.duration / playbackRate);

        const envelope = this.#findEnvelope();
        this.#setupEnvelope(envelope, zone, vol, startWhen, waveDuration, duration);

        const source = this.#audioCtx.createBufferSource();
        source.buffer = zone.buffer;
        source.playbackRate.setValueAtTime(playbackRate, 0);

        if (slides?.length > 0) {
            source.playbackRate.setValueAtTime(playbackRate, startWhen);
            slides.forEach(s => {
                const newRate = Math.pow(2, (100.0 * (pitch + s.delta) - baseDetune) / 1200.0);
                source.playbackRate.linearRampToValueAtTime(newRate, startWhen + s.when);
            });
        }

        source.loop = loop;
        if (loop) {
            const d = zone.delay ?? 0;
            source.loopStart = zone.loopStart / zone.sampleRate + d;
            source.loopEnd = zone.loopEnd / zone.sampleRate + d;
        }

        source.connect(envelope);
        source.start(startWhen, zone.delay ?? 0);
        source.stop(startWhen + waveDuration);

        envelope.audioBufferSourceNode = source;
        envelope.when = startWhen;
        envelope.duration = waveDuration;

        return envelope;
    }


    queueChord(prst, w, pchs, d, v, s) {
        const vol = this.#limitVolume(v);
        return pchs.map((p, i) => this.queueWaveTable(this.#audioCtx, this.#audioCtx.destination, prst, w, p, d, vol - Math.random() * 0.01, s?.[i])).filter(Boolean);
    }


    cancelQueue(audioContext) {
        this.#envelopes.forEach(e => {
            e.gain.cancelScheduledValues(0);
            e.gain.setValueAtTime(this.#nearZero, audioContext.currentTime);
            e.when = -1;
            try { e.audioBufferSourceNode?.disconnect(); } catch (e) { }
        });
    }


    #adjustZone(zone) {
        if (zone.buffer) return Promise.resolve(zone);
        zone.delay = 0;

        if (zone.sample) {
            const decoded = atob(zone.sample);
            zone.buffer = this.#audioCtx.createBuffer(1, decoded.length / 2, zone.sampleRate);
            const float32Array = zone.buffer.getChannelData(0);

            for (let i = 0; i < decoded.length / 2; i++) {
                const b1 = decoded.charCodeAt(i * 2) & 0xFF;
                const b2 = decoded.charCodeAt(i * 2 + 1) & 0xFF;
                let n = (b2 << 8) | b1;
                if (n >= 32768) n -= 65536;
                float32Array[i] = n / 32768.0;
            }
            this.#applyZoneParameters(zone);
            return zone;

        } else if (zone.file) {
            const decoded = atob(zone.file);
            const uint8Array = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) uint8Array[i] = decoded.charCodeAt(i);

            this.#audioCtx.decodeAudioData(
                uint8Array.buffer,
                audioBuffer => {
                    zone.buffer = audioBuffer;
                    this.#applyZoneParameters(zone);
                    return zone;
                },
                error => {
                    console.error("Erreur de décodage audio:", error);
                    return false;
                }
            );
        } else {
            this.#applyZoneParameters(zone);
            return zone;
        }
    };


    #applyZoneParameters(zone) {
        zone.loopStart = this.#numValue(zone.loopStart, 0);
        zone.loopEnd = this.#numValue(zone.loopEnd, 0);
        zone.coarseTune = this.#numValue(zone.coarseTune, 0);
        zone.fineTune = this.#numValue(zone.fineTune, 0);
        zone.originalPitch = this.#numValue(zone.originalPitch, 6000);
        zone.sampleRate = this.#numValue(zone.sampleRate, 44100);
    };


    #setupEnvelope(envelope, zone, volume, when, sampleDuration, noteDuration) {
        envelope.gain.setValueAtTime(this.#noZeroVolume(0), this.#audioCtx.currentTime);

        const duration = Math.min(noteDuration, sampleDuration - this.#afterTime);
        const ahdsr = (zone.ahdsr && zone.ahdsr.length > 0) ? zone.ahdsr : [
            { duration: 0, volume: 1 },
            { duration: duration, volume: 1 }
        ];

        envelope.gain.cancelScheduledValues(when);
        const initialVol = (ahdsr[0]?.volume ?? 1) * volume;
        envelope.gain.setValueAtTime(this.#noZeroVolume(initialVol), when);

        let lastTime = 0;
        let lastVolume = ahdsr[0]?.volume ?? 1;

        for (let i = 0; i < ahdsr.length; i++) {
            const stage = ahdsr[i];
            if (stage.duration > 0) {
                if (stage.duration + lastTime > duration) {
                    const r = 1 - (stage.duration + lastTime - duration) / stage.duration;
                    const n = lastVolume - r * (lastVolume - stage.volume);
                    envelope.gain.linearRampToValueAtTime(this.#noZeroVolume(volume * n), when + duration);
                    break;
                }
                lastTime += stage.duration;
                lastVolume = stage.volume;
                envelope.gain.linearRampToValueAtTime(this.#noZeroVolume(volume * lastVolume), when + lastTime);
            }
        }
        envelope.gain.linearRampToValueAtTime(this.#noZeroVolume(0), when + duration + this.#afterTime);
    }


    #findEnvelope() {
        let envelope = this.#envelopes.find(e => e.target === this.#audioCtx.destination && this.#audioCtx.currentTime > e.when + e.duration + 0.001);
        if (envelope) {
            if (envelope.audioBufferSourceNode) {
                try {
                    envelope.audioBufferSourceNode.stop(0);
                    envelope.audioBufferSourceNode.disconnect();
                } catch (e) { }
                envelope.audioBufferSourceNode = null;
            }
        } else {
            envelope = this.#audioCtx.createGain();
            envelope.gain.value = 0;
            envelope.target = this.#audioCtx.destination;
            envelope.connect(this.#audioCtx.destination);
            envelope.cancel = () => {
                if (envelope.when + envelope.duration > this.#audioCtx.currentTime) {
                    envelope.gain.cancelScheduledValues(0);
                    envelope.gain.setTargetAtTime(this.#nearZero, this.#audioCtx.currentTime, 0.1);
                    envelope.when = this.#audioCtx.currentTime + 0.00001;
                    envelope.duration = 0;
                }
            };
            this.#envelopes.push(envelope);
        }
        return envelope;
    }


    #findZone(pitch) {
        const zone = this.#preset.zones.findLast(z => pitch >= z.keyRangeLow && pitch <= z.keyRangeHigh + 1);
        if (zone) this.#adjustZone(this.#audioCtx, zone);
        return zone;
    };

    
    #limitVolume(v) {
        const requestedVolume = v ? 1.0 * v : 0.5;
        return Math.min(requestedVolume, 0.8);
    };


    #noZeroVolume(n) {
        return n > this.#nearZero ? n : this.#nearZero;
    }


    #numValue(a, b) {
        return typeof a === "number" ? a : b;
    }

}


class WebAudioFontChannel {

    #input = null;
    #output = null;
    #audioCtx = null;
    #limiter = null;

    constructor(audioCtx) {
        this.#audioCtx = audioCtx;
        this.#input = this.#audioCtx.createGain();

        let lastNode = this.#input;
        [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384].forEach(freq => {
            lastNode = this.#bandEqualizer(lastNode, freq);
            this[`band${freq < 1000 ? freq : (freq / 1024) + 'k'}`] = lastNode;
        });

        this.#limiter = this.#audioCtx.createDynamicsCompressor();
        this.#limiter.threshold.setValueAtTime(-3.0, this.#audioCtx.currentTime);
        this.#limiter.ratio.setValueAtTime(40, this.#audioCtx.currentTime);
        this.#limiter.attack.setValueAtTime(0.000, this.#audioCtx.currentTime);
        this.#limiter.release.setValueAtTime(0.25, this.#audioCtx.currentTime);
        this.#output = this.#audioCtx.createGain();
        lastNode.connect(this.#limiter);
        this.#limiter.connect(this.#output);
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

}


export default WebAudioFontPlayer;