import MidiPlayer from 'midi-player-js';
import WebAudioFontPlayer from "./webaudiofontplayer";
import DefaultPreset from "./presets/defaultpreset.json";


export default class MidiAudioPlayer extends MidiPlayer.Player {

    static ENDPOINT = 'https://zmotrin.github.io/webaudiofontjson/';
    
    static PIANO =    1;
    static BASS =     2;
    static STRINGS =  3;
    static SYNTH =    4;
    static DRUM =    10;

    #catalog = null;

	#audioCtx = null;
	#activeNotes = null;
    #players = {
        1:  null,
        2:  null,
        3:  null,
        4:  null,
        10: null,
    };

    #presets = {
        1:  null,
        2:  null,
        3:  null,
        4:  null,
        10: null,
    };


	#opts = {
		preset: DefaultPreset,
        volume: 0.5,
		onEndFile: null,
        localCache: false,
        presets: null,
	};


	constructor(opts = {}) {
        super(event => this.#handleMidiPipeline(event));
		this.#opts = { ...this.#opts, ...opts };
        this.#activeNotes = new Map();
		this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		        
        Object.keys(this.#players).forEach(k => this.#players[k] = new WebAudioFontPlayer(this.#audioCtx, this.#opts.preset));

        this.on('endOfFile', async () => {
			await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 1)));
			await this.#endOfFile();
        });
	}


    async getCatalog() {   
        if(this.#catalog) return this.#catalog;
        const cachedata = this.#opts.localCache ? localStorage.getItem('waf_catalog') : sessionStorage.getItem('waf_catalog');
        if (cachedata) {
            this.#catalog = JSON.parse(cachedata);
        } else {
            const response = await fetch(`${MidiAudioPlayer.ENDPOINT}catalog.json`);
            this.#catalog = await response.json();
            if(this.#opts.localCache) localStorage.setItem('waf_catalog', JSON.stringify(this.#catalog));
            else sessionStorage.setItem('waf_catalog', JSON.stringify(this.#catalog));
        }
        return this.#catalog;
    }


    async getCategories() {
        const catalog = await this.getCatalog();
        return catalog.categories;
    }


    async getPreset(id) {

        
    }



    async load(content) {
		if(this.isPlaying()) this.stop();
		this.#clearActiveNotes();
		await this.loadArrayBuffer(content);
	}


	async play(content = null) {
		if(content) await this.load(content);
        await this.#audioCtx.resume();
		await super.play();
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


	async #endOfFile() {
		if(typeof this.#opts.onEndFile == 'function') await this.#opts.onEndFile();
	}


    async #handleMidiPipeline(event) {
        if (event.name !== 'Note on' && event.name !== 'Note off') return;
        if (!this.isPlaying()) return;
        if (event.noteNumber === undefined) return;
        switch (event.name) {
            case 'Note on':
                console.log(event);
                if (event.velocity > 0 && event.velocity <= 127) {
                    this.#stopNotePipe(event.noteNumber);
                    const normalizedMaster = this.#opts.volume * 100 / 256;
                    const masterGain = Math.pow(normalizedMaster, 2);
                    const noteVelocityRatio = event.velocity / 127;
                    const finalVol = masterGain * Math.pow(noteVelocityRatio, 2);

                    const envelope = this.#players[event.channel]?.queueWaveTable(0, event.noteNumber, 2, finalVol);
                    this.#activeNotes.set(event.noteNumber, envelope);
                } else {
                    this.#stopNotePipe(event.noteNumber);
                }
                break;
            case 'Note off':
                this.#stopNotePipe(event.noteNumber);
                break;
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

