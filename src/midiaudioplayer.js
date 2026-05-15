import MidiPlayer from 'midi-player-js';
import WebAudioFontPlayer from "./libraries/webaudiofontplayer";
import AudioCompressor from './libraries/audiocompressor';
import indexedDbStorage from './libraries/indexeddbstorage';
import DefaultPreset from "./presets/defaultpreset.json";

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

export default class MidiAudioPlayer extends MidiPlayer.Player {

    static ENDPOINT       = 'https://zmotrin.github.io/webaudiofontjson/';
    static DEFAULTPRESET  = -1;
    static REFERENCE_GAIN = 0.15;

    #catalog     = null;
	#audioCtx    = null;
	#compressor  = null;
    #activeNotes = {};
    #players     = {};

	#opts = {
        volume: 0.7,
        reverb: 0,
        onEndFile: null,
        localCache: false,
        presetAuto: false,
        presetRandom: false,
        presets: { [-1]: -1 },
	};


	constructor(opts = {}) {
        super(event => this.#handleMidiPipeline(event));
        this.#opts.presets = { ...this.#opts.presets, ...Object.fromEntries(Array.from({ length: 128 }, (_, i) => [i + 1, -1]))};
        this.#opts = {
            ...this.#opts,
            ...opts,
            presets: {
                ...this.#opts.presets,
                ...(opts.presets || {})
            },
        };
		this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.#compressor = new AudioCompressor(this.#audioCtx, this.#opts.volume, this.#opts.reverb);
	}

    get volume() { return this.#opts.volume; }
    set volume(vol) { this.#opts.volume = clamp(vol, 0, 1); this.#compressor.masterVolume = this.#opts.volume; }
    get rever() { return this.#compressor.reverb; }
    set rever(rev) { this.#compressor.reverb = rev; }
    

    async getCatalog() {
        if(this.#catalog) return this.#catalog;
        const cachedata = this.#opts.localCache ? await indexedDbStorage.getItem('waf_catalog') : null;
        if (cachedata) this.#catalog = JSON.parse(cachedata);
        else {
            this.#log(`Downloading catalog...`);
            const response = await fetch(`${MidiAudioPlayer.ENDPOINT}catalog.json`);
            this.#catalog = await response.json();
            if(this.#opts.localCache) await indexedDbStorage.setItem('waf_catalog', JSON.stringify(this.#catalog));
        }
        return this.#catalog;
    }


    async getCategories() {
        return (await this.getCatalog()).categories;
    }


    async getPreset(id) {
        try {
            if(id == '-1') return DefaultPreset;
            if(typeof id === 'object') return id;
            const cacheid = `waf_preset_${id}`;
            const cachedata = this.#opts.localCache ? await indexedDbStorage.getItem(cacheid) : null;
            if (cachedata) return JSON.parse(cachedata);
            this.#log(`Downloading preset ${id}...`);
            const response = await fetch(`${MidiAudioPlayer.ENDPOINT}presets/${id}.json`);
            const preset = await response.json();
            if(this.#opts.localCache) await indexedDbStorage.setItem(cacheid, JSON.stringify(preset));
            return preset;
        } catch(e) {
            throw new Error(`Invalid preset: ${id}`);
        }
    }


    async load(content) {
		if(this.isPlaying()) this.stop();
		this.#clearActiveNotes();
		this.#log('Loading buffer...');
        await this.loadArrayBuffer(content);
        this.#log('Loading instruments...');
        const instruments = await this.#getInstruments();
        if(!Object.values(instruments).length) this.#log("Error: no instrument found");
        if(this.#opts.presetRandom || this.#opts.presetAuto) await this.getCatalog();
        await Promise.all(Object.keys(instruments).map(async channel => {
            let preset = null;
            if((this.#opts.presetAuto || this.#opts.presetRandom) && this.#opts.presets[instruments[channel]] != MidiAudioPlayer.DEFAULTPRESET) preset = await this.getPreset(this.#opts.presets[instruments[channel]]);
            else if(this.#opts.presetRandom) preset = await this.#getRandomPreset(instruments[channel]);
            else if(this.#opts.presetAuto) preset = await this.#getAutoPreset(instruments[channel]);
            else preset = await this.getPreset(this.#opts.presets[instruments[channel]]);
            this.#players[channel] = await this.#createWebAudioFontPlayer(preset);
        }));
        return true;
	}


	async play(content = null) {
		if(content) await this.load(content);
		this.#compressor.restoreReverb();
        return await super.play();
	}


	async pause() {
        await super.pause();
        this.#compressor.killReverbTail();
        await this.#clearActiveNotes();
        await Promise.all(Object.keys(this.#players).map(async k => await this.#players[k]?.cancelQueue()));
	}


    async stop() {
        await super.stop();
        this.#compressor.killReverbTail();
        await this.#clearActiveNotes();
        await Promise.all(Object.keys(this.#players).map(async k => await this.#players[k]?.cancelQueue()));
	}


    getRealTimeVolume() {
        const analyser = this.#compressor.analyser;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        let values = 0;
        for (let i = 0; i < dataArray.length; i++) values += dataArray[i];
        return (values / dataArray.length / 255);
    }


    getSongTimeRemaining() {
        return this.ticksToSeconds(this.getCurrentTick(), this.totalTicks);
    }


    async generateWaveformSVG(samples = 1000) {
        if (!this.totalTicks || !this.events) return '';
        const waveform = new Array(samples).fill(0);
        const tickInterval = this.totalTicks / samples;
        this.events.forEach(track => {
            track.forEach(event => {
                if (event.name === 'Note on' && event.velocity > 0) {
                    const idx = Math.floor(event.tick / tickInterval);
                    if (idx < samples) waveform[idx] += event.velocity;
                }
            });
        });
        const maxAmp = Math.max(...waveform);
        const normalized = maxAmp > 0 ? waveform.map(v => v / maxAmp) : waveform;
        const width = samples;
        const height = width / 5;
        const points = normalized.map((val, i) => {
            const x = i;
            const y = height - (val * height);
            return `${x},${y.toFixed(2)}`;
        });
        const d = `M ${points.join(' L ')}`;
        return `<svg class="midiaudioplayer-waveform" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" style="background:transparent; display:blockk; width:100%; height:auto;"><path d="${d}" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
    }


    async extractLyrics() {
        const structure = { language: "", title: "", paragraphs: [{ lines: [{ blocks: [] }] }] };
        let currentPara = structure.paragraphs[0];
        let currentLine = currentPara.lines[0];
        this.events.forEach(track => {
            track.forEach(event => {
                if (event.name === 'Text Event' || event.name === 'Lyric Event') {
                    let text = event.string;
                    if (text.startsWith('@L')) structure.language = text.substring(2);
                    if (text.startsWith('@T')) structure.title += (structure.title ? ' / ' : '') + text.substring(2);
                    if (text.startsWith('\\')) {
                        const newPara = { tick: event.tick, lines: [{ blocks: [] }] };
                        structure.paragraphs.push(newPara);
                        currentPara = newPara;
                        currentLine = currentPara.lines[0];
                        text = text.substring(1);
                    }
                    if (text.startsWith('/')) {
                        const newLine = { tick: event.tick, blocks: [] };
                        currentPara.lines.push(newLine);
                        currentLine = newLine;
                        text = text.substring(1);
                    }
                    if(!event.tick) return;
                    if (text.length > 0) {
                        currentLine.blocks.push({
                            text: text,
                            tick: event.tick
                        });
                    }
                }
            });
        });
        structure.paragraphs = structure.paragraphs.filter(p => p.lines.some(l => l.blocks.length > 0));
        return structure;
    }


    async triggerPlayerEvent(playerEvent, data) {
        if(playerEvent == 'fileLoaded') {
            super.triggerPlayerEvent(playerEvent, {
                tempo: this.tempo,
                division: this.division,
                duration: this.getSongTime(),
                sampleRate: this.sampleRate,
                totalTicks: this.totalTicks,
                totalEvents: this.totalEvents,
                instruments: await this.#getInstruments(),
            });
        } else if(playerEvent == 'endOfFile') {
            requestAnimationFrame(() => setTimeout(() => {
                super.stop();
                super.triggerPlayerEvent(playerEvent, data);
            }, 1))
        } else {
            super.triggerPlayerEvent(playerEvent, data);
        }
    }


    async #getInstruments() {
        const instrumentMap = {};
        this.events.forEach(track => {
            track.forEach(event => {
                if (event.name === 'Program Change') {
                    if(event.channel == 10) instrumentMap[event.channel] = -1;
                    else instrumentMap[event.channel] = event.value + 1;
                }
            });
        });
        return instrumentMap;
    }


    async #getProgramInstruments(program) {
        const categories = await this.getCategories();
        let instruments = [];
        await Promise.all(categories.map(async category => category.instruments.filter(elm => elm.program == program).forEach(elm => instruments = [...instruments, ...elm.presets])));
        return instruments;
    }


    async #getRandomPreset(program) {
        const instruments = await this.#getProgramInstruments(program);
        if(!instruments.length) return null;
        return await this.getPreset(instruments[Math.floor(Math.random() * instruments.length)].id);
    }


    async #getAutoPreset(program) {
        const instruments = await this.#getProgramInstruments(program);
        if(!instruments.length) return null;
        return await this.getPreset(instruments[0].id);
    }


    async #createWebAudioFontPlayer(preset) {
        return new WebAudioFontPlayer(this.#audioCtx, this.#compressor, preset);
    }


	async #endOfFile() {
		if(typeof this.#opts.onEndFile == 'function') await this.#opts.onEndFile();
	}


    async #handleMidiPipeline(event) {
        if(event.tick < (this.getCurrentTick() - 100)) return;
        if(!this.isPlaying()) return;
        switch (event.name) {
            case 'Text Event':
                if(event.string.startsWith('@')) break;
                if(!event.tick) break;
                const text = /^[\\\/]/i.test(event.string) ? event.string.substring(1) : event.string;
                this.triggerPlayerEvent('lyrics', {
                    string: text,
                    tick: event.tick,
                    paragraphe: event.string.startsWith('\\'),
                    line: event.string.startsWith('/')
                });
                break;
            case 'Note on':
                if(event.noteNumber === undefined) return;
                if (event.velocity > 0 && event.velocity <= 127) {
                    this.#stopNote(event.channel, event.noteNumber);
                    const normalizedMaster = this.#opts.volume * 100 / 255;
                    const masterGain = Math.pow(normalizedMaster, 2);
                    const noteVelocityRatio = event.velocity / 127;
                    const finalVol = MidiAudioPlayer.REFERENCE_GAIN * Math.pow(noteVelocityRatio, 2);
                    const envelope = this.#players[event.channel]?.queueWaveTable(0, event.noteNumber, 2, finalVol);
                    if(envelope) this.#addNote(event.channel, event.noteNumber, envelope)
                } else this.#stopNote(event.channel, event.noteNumber);
                break;
            case 'Note off':
                if(event.noteNumber === undefined) return;
                this.#stopNote(event.channel, event.noteNumber);
                break;
            case 'Controller Change':
                this.#players[event.channel]?.setController(event.number, event.value);
                break;
            case 'Pitch Bend':
                this.#players[event.channel]?.setPitchBend?.(event.value);
                break;
            case 'Program Change':
                break;

        }
    }


    #addNote(channel, note, envelope) {
        if(!this.#activeNotes[channel]) this.#activeNotes[channel] = new Map();
        this.#activeNotes[channel].set(note, envelope);
    }


    #stopNote(channel, noteNumber) {
        const player = this.#players[channel];
        const envelope = this.#activeNotes[channel]?.get(noteNumber);
        if (envelope) {
            if (player && player.isSustainActive()) {
                player.registerSustainNote(() => {
                    envelope.cancel();
                    this.#activeNotes[channel]?.delete(noteNumber);
                });
            } else {
                envelope.cancel();
                this.#activeNotes[channel]?.delete(noteNumber);
            }
        }
    }


    #clearActiveNotes() {
        Object.values(this.#activeNotes).map(map => {
            map.forEach((envelope, note) => {
                if (envelope && envelope.cancel) {
                    envelope.cancel();
                }
            });
        });
    }


    #log(str) {
        this.triggerPlayerEvent('logs', str);
    }

}