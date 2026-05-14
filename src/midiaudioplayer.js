import MidiPlayer from 'midi-player-js';
import WebAudioFontPlayer from "./webaudiofontplayer";
import AudioCompressor from './audiocompressor';
import indexedDbStorage from './indexeddbstorage';
import DefaultPreset from "./presets/defaultpreset.json";


export default class MidiAudioPlayer extends MidiPlayer.Player {

    static ENDPOINT = 'https://zmotrin.github.io/webaudiofontjson/';

    static DEFAULTPRESET = -1;

    #catalog     = null;
	#audioCtx    = null;
	#activeNotes = null;
    #compressor  = null;
    #instruments = {};
    #players     = {};


	#opts = {
        volume: 0.6,
        onEndFile: null,
        localCache: true,
        presetAuto: false,
        presetRandom: false,
        presets: { [-1]: -1 },
	};


	constructor(opts = {}, onReady = null) {
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

        this.#activeNotes = new Map();
		this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.#compressor = new AudioCompressor(this.#audioCtx);
        // this.#preloadPresets(onReady);
        if(typeof onReady == 'function') onReady();

        this.on('endOfFile', async () => {
			await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 1)));
			await this.#endOfFile();
        });
	}


    async #preloadPresets(onReady = null) {
        // await Promise.all(Object.keys(this.#opts.presets).map(async k => this.#opts.presets[k] = await this.getPreset(this.#opts.presets[k])));
        // await Object.keys(this.#players).map(async k => this.#players[k] = new WebAudioFontPlayer(this.#audioCtx, this.#compressor, this.#opts.presets[k]));
        if(typeof onReady == 'function') onReady();
    }

    async getCatalog() {   
        if(this.#catalog) return this.#catalog;
        const cachedata = this.#opts.localCache ? await indexedDbStorage.getItem('waf_catalog') : null;
        if (cachedata) this.#catalog = JSON.parse(cachedata);
        else {
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
            const response = await fetch(`${MidiAudioPlayer.ENDPOINT}presets/${id}.json`);
            const preset = await response.json();
            if(this.#opts.localCache) await indexedDbStorage.setItem(cacheid, JSON.stringify(preset));
            return preset;
        } catch(e) {
            throw new Error(`Invalid preset: ${id}`);
        }
    }

    
    // async loadPreset(id, channel = MidiAudioPlayer.CHANNELAUTO) {
    //     const preset = await this.getPreset(id);
    //     const player = new WebAudioFontPlayer(this.#audioCtx, this.#compressor, preset);
    //     if(channel == MidiAudioPlayer.CHANNELAUTO) this.#players[preset.channel] = player;
    //     else this.#players[channel] = player;
    // }


    async load(content) {
		if(this.isPlaying()) this.stop();
		this.#clearActiveNotes();
		await this.loadArrayBuffer(content);
        this.#instruments = await this.#getInstruments();
        await Promise.all(Object.keys(this.#instruments).map(async channel => {
            
            let preset = null;
            if((this.#opts.presetAuto || this.#opts.presetRandom) && this.#opts.presets[this.#instruments[channel]] != MidiAudioPlayer.DEFAULTPRESET) {
                preset = this.getPreset(this.#opts.presets[this.#instruments[channel]]);
                // this.#players[channel] = await this.#createWebAudioFontPlayer(preset);
            } else if(this.#opts.presetRandom) {
                preset = this.#getRandomPreset(this.#instruments[channel]);
                // this.#players[channel] = await this.#createWebAudioFontPlayer(preset);
            } else if(this.#opts.presetAuto) {
                preset = this.#getAutoPreset(this.#instruments[channel]);
                // this.#players[channel] = await this.#createWebAudioFontPlayer(preset);
            } else {
                preset = this.getPreset(this.#opts.presets[this.#instruments[channel]]);
                // this.#players[channel] = await this.#createWebAudioFontPlayer(preset);
            }
            this.#players[channel] = await this.#createWebAudioFontPlayer(await preset);
        }));
	}


	async play(content = null) {
		if(content) await this.load(content);
        await this.#audioCtx.resume();
		return await super.play();
	}
    

	async pause() {
        await super.pause();
        await this.#clearActiveNotes();
        await Promise.all(Object.keys(this.#players).map(async k => await this.#players[k]?.cancelQueue()));
	}

	
    async stop() {
        await super.stop();
        await this.#clearActiveNotes();
        await Promise.all(Object.keys(this.#players).map(async k => await this.#players[k]?.cancelQueue()));
	}
    

    // async setActiveChannel(channel, value) {
    //     this.#opts.activeChannels[channel] = value;
    //     if(!value) this.#clearChannel(channel);
    // }


    getRealTimeVolume() {
        const analyser = this.#compressor.analyser;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        let values = 0;
        for (let i = 0; i < dataArray.length; i++) values += dataArray[i];
        return (values / dataArray.length / 255);
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
        // console.log(instruments);
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
        // console.log(event);
        if (event.name !== 'Note on' && event.name !== 'Note off') return;
        if (!this.isPlaying()) return;
        if (event.noteNumber === undefined) return;
        switch (event.name) {
            case 'Note on':
                // console.log(event.channel);
                // console.log(Object.keys(this.#opts.activeChannels));
                // if(event.channel == 9) event.channel = 10;
                // if(!Object.keys(this.#opts.activeChannels).includes(''+event.channel)) {
                //     console.log(event.channel);
                //     event.channel = 1;
                // }
                // if(!this.#opts.activeChannels[event.channel]) break;
                if (event.velocity > 0 && event.velocity <= 127) {
                    this.#stopNotePipe(event.noteNumber);
                    const normalizedMaster = this.#opts.volume * 100 / 255;
                    const masterGain = Math.pow(normalizedMaster, 2);
                    const noteVelocityRatio = event.velocity / 127;
                    const finalVol = masterGain * Math.pow(noteVelocityRatio, 2);
                    const envelope = this.#players[event.channel]?.queueWaveTable(0, event.noteNumber, 2, finalVol);
                    if(envelope) {
                        envelope.channel = event.channel;
                        this.#activeNotes.set(event.noteNumber, envelope);
                    }
                } else {
                    this.#stopNotePipe(event.noteNumber);
                }
                break;
            case 'Note off':
                this.#stopNotePipe(event.noteNumber);
                break;
        }
    }


    #clearChannel(channel) {
        if (this.#activeNotes) {
            this.#activeNotes.forEach((envelope, note) => { 
                if (envelope && envelope.cancel && envelope.channel == channel) {
                    envelope.cancel();
                    this.#activeNotes.delete(note);
                }
            });
        }
    }


    #stopNotePipe(noteNumber) {
        const envelope = this.#activeNotes.get(noteNumber);
        if (envelope) {
            envelope.cancel();
            this.#activeNotes.delete(noteNumber);
        }
    }


    #clearActiveNotes() {
        if (this.#activeNotes) {
            this.#activeNotes.forEach((envelope, note) => { if (envelope && envelope.cancel) envelope.cancel(); });
            this.#activeNotes.clear();
        }
    }

}

