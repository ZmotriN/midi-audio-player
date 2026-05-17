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

    #catalog       = null;
	#audioCtx      = null;
	#compressor    = null;
    #activeNotes   = {};
    #channelStates = {};
    #instruments   = {};
    #players       = {};
    #channels      = {};
    #title         = '';

	#opts = {
        volume: 0.7,
        reverb: 0,
        onEndFile: null,
        localCache: false,
        presetAuto: false,
        presetRandom: false,
        preferred: [],
        karaoke: false,
        karaokeDelay: 0,
        muteExpression: false,
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
        if(this.#opts.karaoke) {
            queueMicrotask(() => this.triggerPlayerEvent('karaoke', `<span class="karaoke-intro"></span>`));
        }
	}

    get channels() { return this.#players; }
    get channelStates() { return this.#channelStates; }
    get volume() { return this.#opts.volume; }
    set volume(vol) { this.#opts.volume = clamp(vol, 0, 1); this.#compressor.masterVolume = this.#opts.volume; }
    get rever() { return this.#compressor.reverb; }
    set rever(rev) { this.#compressor.reverb = rev; }
    get muteExpression() { return this.#opts.muteExpression; }
    set muteExpression(val) { this.#opts.muteExpression = Boolean(val); }


    async close() {
        await this.#audioCtx.close();
    }


    async getCatalog() {
        if(this.#catalog) return this.#catalog;
        const cachedata = this.#opts.localCache ? await indexedDbStorage.getItem('waf_catalog') : null;
        if (cachedata) this.#catalog = JSON.parse(cachedata);
        else {
            this.#log(`Downloading catalog...`);
            const response = await fetch(`${MidiAudioPlayer.ENDPOINT}catalog.json`);
            if (!response.ok) throw new Error(`Impossible to download catalog: ${response.status}`);
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
            if(preset.zones === undefined) {
                console.error(`Invalid preset: ${$id}`);
                throw new Error(`Invalid preset: ${$id}`);
            }
            if(this.#opts.localCache) await indexedDbStorage.setItem(cacheid, JSON.stringify(preset));
            return preset;
        } catch(e) {
            throw new Error(`Invalid preset: ${id}`);
        }
    }


    async load(content) {
		if(this.isPlaying()) this.stop();
		this.#clearActiveNotes();
        Object.values(this.#players).map(async player => player.close());
        this.#players = {};
        this.#instruments = {};
        this.#activeNotes = {};
		this.#log('Loading buffer...');
        await this.loadArrayBuffer(content);
        this.#log('Loading instruments...');
        this.#instruments = {};
        this.#channels = await this.#getInstruments();
        this.#channelStates = Object.keys(this.#channels).reduce((acc, key) => ({ ...acc, [key]: false }), {});
        const uniqueInstruments = await this.#getUniqueInstruments();
        if(!Object.values(this.#channels).length) this.#log("Error: no instrument found");
        if(this.#opts.presetRandom || this.#opts.presetAuto) await this.getCatalog();
        await Promise.all([...uniqueInstruments].map(async program => {
            let preset = null;
            if((this.#opts.presetAuto || this.#opts.presetRandom) && this.#opts.presets[program] != MidiAudioPlayer.DEFAULTPRESET) preset = await this.getPreset(this.#opts.presets[program]);
            else if(this.#opts.presetRandom) preset = await this.#getRandomPreset(program);
            else if(this.#opts.presetAuto) preset = await this.#getAutoPreset(program);
            else preset = await this.getPreset(this.#opts.presets[program]);
            this.#instruments[program] = preset;
        }));
        await Promise.all(Object.keys(this.#channels).map(async channel => {
            if(this.#players[channel]) this.#players[channel].close();
            this.#players[channel] = await this.#createWebAudioFontPlayer(this.#instruments[this.#channels[channel]]);
        }));
        super.triggerPlayerEvent('presetsLoaded', this.#instruments);
        return this.#players;
	}


	async play(content = null) {
        if (this.#audioCtx.state === 'suspended') await this.#audioCtx.resume();
		if(content) await this.load(content);
        await Promise.all(Object.keys(this.#players).map(async k => await this.#players[k]?.cancelQueue()));
        this.#compressor.restoreReverb();
        return await super.play();
	}


	async pause() {
        await super.pause();
        this.#compressor.killReverbTail();
        await this.#clearActiveNotes();
        await Promise.all(Object.keys(this.#players).map(async k => await this.#players[k]?.cancelQueue()));
	}


    async stop(skipKill = false) {
        await super.stop();
        if(!skipKill) {
            this.#compressor.killReverbTail();
            await Promise.all(Object.keys(this.#players).map(async k => await this.#players[k]?.cancelQueue()));
        }
        await this.#clearActiveNotes();
        if(this.#opts.karaoke) this.triggerPlayerEvent('karaoke', `<span class="karaoke-intro"></span>`);
	}


    getRealTimeVolume() {
        const analyser = this.#compressor.analyser;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        let values = 0;
        for (let i = 0; i < dataArray.length; i++) values += dataArray[i];
        return values / (dataArray.length * 100);
    }


    getSongTimeRemaining() {
        return this.ticksToSeconds(this.getCurrentTick(), this.totalTicks);
    }


    async generateWaveformSVG(samples = 1000) {
        if (!this.totalTicks || !this.events) return '';
        const waveform = new Array(samples).fill(0);
        const tickInterval = this.totalTicks / samples;
        const allEvents = this.events
            .flatMap((track, trackIdx) =>
                track.map(event => ({
                    ...event,
                    computedChannel: event.channel !== undefined ? event.channel : trackIdx
                }))
            )
            .filter(event =>
                event.name === 'Controller Change' ||
                event.name === 'Program Change' ||
                (event.name === 'Note on' && event.velocity > 0)
            )
            .sort((a, b) => a.tick - b.tick);
        const channelsVolume = new Map();
        const channelsExpression = new Map();
        allEvents.forEach(event => {
            const idx = Math.floor(event.tick / tickInterval);
            if (idx >= samples) return;
            const chan = event.computedChannel;
            if (!channelsVolume.has(chan)) channelsVolume.set(chan, 100);
            if (!channelsExpression.has(chan)) channelsExpression.set(chan, 127);
            if (event.name === 'Controller Change') {
                if (event.number === 7) channelsVolume.set(chan, event.value);
                else if (event.number === 11) channelsExpression.set(chan, event.value);
            }
            else if (event.name === 'Note on') {
                const volFactor = channelsVolume.get(chan) / 127;
                const expFactor = channelsExpression.get(chan) / 127;
                const modulatedVelocity = event.velocity * volFactor * expFactor;
                waveform[idx] += modulatedVelocity;
            }
        });
        const maxAmp = waveform.reduce((max, val) => {
            if (isNaN(val)) return max;
            return val > max ? val : max;
        }, 0);
        const normalized = maxAmp > 0 ? waveform.map(v => isNaN(v) ? 0 : v / maxAmp) : waveform.fill(0);
        const width = samples;
        const height = width / 5;
        const points = normalized.map((val, i) => {
            const x = i;
            const y = Math.max(0, Math.min(height, height - (val * height)));
            return `${x},${y.toFixed(2)}`;
        });
        const d = `M 0,${height} L ${points.join(' L ')} L ${width},${height}`;
        return `<svg class="midiaudioplayer-waveform" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
    }


    async triggerPlayerEvent(playerEvent, data) {
        if(playerEvent == 'fileLoaded') {
            if(this.#opts.karaoke) {
                await this.generateKaraokeFrames();
            }
            super.triggerPlayerEvent(playerEvent, {
                tempo: this.tempo,
                division: this.division,
                duration: this.getSongTime(),
                sampleRate: this.sampleRate,
                totalTicks: this.totalTicks,
                totalEvents: this.totalEvents,
                channels: await this.#channels,
            });
        } else if(playerEvent == 'endOfFile' && this.#opts.karaoke) {
            queueMicrotask(() => this.triggerPlayerEvent('karaoke', `<span class="karaoke-intro"></span>`));
            super.triggerPlayerEvent(playerEvent, data);
        } else super.triggerPlayerEvent(playerEvent, data);
    }


    playLoop(dryRun) {
        if (this.inLoop) return;
        if (!dryRun && this.endOfFile() && this.tick > 0) {
            this.stop(true);
            this.tick = 0;
            queueMicrotask(() => this.triggerPlayerEvent('endOfFile'));
            return;
        }
        this.inLoop = true;
        this.tick = this.getCurrentTick();
        this.tracks.forEach((track) => {
            const result = track.handleEvent(this.tick, dryRun);
            if (!result) return;
            const events = Array.isArray(result) ? result : [result];
            events.forEach((event) => {
                const { name, data, value } = event;
                if (name === 'Set Tempo') this.setTempo(data);
                if (dryRun) {
                    if (name === 'Program Change' && !this.instruments.includes(value)) {
                        this.instruments.push(value);
                    }
                } else this.emitEvent(event);
            });
        });
        if (!dryRun && this.isPlaying()) this.triggerPlayerEvent('playing', { tick: this.tick });
        this.inLoop = false;
    }


    ticksToSeconds(startTick, endTick) {
        // Si endTick n'est pas défini, on assume que startTick est la cible depuis le début (0)
        if (endTick === undefined) {
            endTick = startTick;
            startTick = 0;
        }

        if (startTick >= endTick) return 0;
        let seconds = 0;
        const len = this.tempoMap.length;
        const timeFactor = 60 / this.division;
        let low = 0;
        let high = len - 1;
        let startIndex = 0;

        while (low <= high) {
            const mid = (low + high) >> 1;
            if (this.tempoMap[mid].tick <= startTick) {
                startIndex = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        let currentTick = startTick;
        for (let i = startIndex; i < len; i++) {
            const entry = this.tempoMap[i];
            const nextTick = (i + 1 < len) ? this.tempoMap[i + 1].tick : endTick;
            if (nextTick <= startTick) continue;
            const segStart = Math.max(entry.tick, startTick);
            const segEnd = Math.min(nextTick, endTick);
            if (segStart >= endTick) break;
            seconds += ((segEnd - segStart) / entry.tempo) * timeFactor;
            currentTick = segEnd;
        }

        if (currentTick < endTick) {
            const lastEntry = this.tempoMap[len - 1];
            seconds += ((endTick - currentTick) / lastEntry.tempo) * timeFactor;
        }

        return seconds;
    }


    secondsToTicks(seconds) {
        let remainingSeconds = seconds;
        const len = this.tempoMap.length;
        const factor = 60 / this.division;
        for (let i = 0; i < len; i++) {
            const entry = this.tempoMap[i];
            const nextTick = (i + 1 < len) ? this.tempoMap[i + 1].tick : Infinity;
            const segmentTicks = nextTick - entry.tick;
            const segmentSeconds = (segmentTicks / entry.tempo) * factor;
            if (remainingSeconds <= segmentSeconds) {
                return entry.tick + Math.round((remainingSeconds * entry.tempo) / factor);
            }
            remainingSeconds -= segmentSeconds;
        }
        return this.totalTicks;
    }


    getTickBeforeSeconds(targetTick, seconds) {
        if (targetTick <= 0) return 0;
        const targetTime = this.ticksToSeconds(0, targetTick);
        const desiredTime = Math.max(0, targetTime - seconds);
        return this.secondsToTicks(desiredTime);
    }


    async getProgramInstruments(program) {
        const categories = await this.getCategories();
        let instruments = [];
        await Promise.all(categories.map(async category => category.instruments.filter(elm => elm.program == program).forEach(elm => instruments = [...instruments, ...elm.presets])));
        return instruments;
    }


    async #getInstruments() {
        const instrumentMap = {};
        const channelUsed = new Set();
        this.events.forEach(track => {
            track.forEach(event => {
                if (event.name === 'Program Change' && (event.value + 1) <= 128) {
                    if(instrumentMap[event.channel]) return;
                    else if(event.channel == 10) instrumentMap[event.channel] = -1;
                    else instrumentMap[event.channel] = event.value + 1;
                }  else if (event.name === 'Note on' && event.channel == 10) {
                    instrumentMap[event.channel] = -1;
                    channelUsed.add(10);
                } else if(event.name === 'Note on') {
                    channelUsed.add(event.channel);
                }
            });
        });
        Object.keys(instrumentMap).forEach(channel => {
            if(!channelUsed.has(Number(channel))) delete instrumentMap[channel];
        });
        return instrumentMap;
    }


    async #getUniqueInstruments() {
        const instrumentMap = new Set();
        this.events.forEach(track => {
            track.forEach(event => {
                if (event.name === 'Program Change') {
                    instrumentMap.add(event.channel == 10 ? -1 : (event.value + 1));
                } else if (event.name === 'Note on' && event.channel == 10) instrumentMap.add(-1);
            });
        });
        return instrumentMap;
    }


    async #getRandomPreset(program) {
        const instruments = await this.getProgramInstruments(program);
        if(!instruments.length) return null;
        return await this.getPreset(instruments[Math.floor(Math.random() * instruments.length)].id);
    }


    async #getAutoPreset(program) {
        const instruments = await this.getProgramInstruments(program);
        if(!instruments.length) return null;
        let preset = null;
        this.#opts.preferred.some(bank => {
            preset = instruments.find(elm => elm.bank == bank);
            if(preset) return true;
        });
        if(preset) return await this.getPreset(preset.id);
        else return await this.getPreset(instruments[0].id);
    }


    async #createWebAudioFontPlayer(preset) {
        return new WebAudioFontPlayer(this.#audioCtx, this.#compressor, preset);
    }


    async #handleMidiPipeline(event) {
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
                if (event.tick < (this.tick - 100)) return;
                if (event.noteNumber === undefined) return;
                if (event.channel == 4 && this.#opts.muteExpression) return;
                if (event.velocity > 0 && event.velocity <= 127) {
                    this.#stopNote(event.channel, event.noteNumber);
                    const normalizedMaster = this.#opts.volume * 100 / 255;
                    const masterGain = Math.pow(normalizedMaster, 2);
                    const noteVelocityRatio = event.velocity / 127;
                    const finalVol = MidiAudioPlayer.REFERENCE_GAIN * Math.pow(noteVelocityRatio, 2);
                    const envelope = this.#players[event.channel]?.queueWaveTable(0, event.noteNumber, 2, finalVol);
                    if (envelope) this.#addNote(event.channel, event.noteNumber, envelope)
                } else {
                    this.#stopNote(event.channel, event.noteNumber);
                }
                break;
            case 'Note off':
                if (event.noteNumber === undefined) return;
                this.#stopNote(event.channel, event.noteNumber);
                break;
            case 'Controller Change':
                this.#players[event.channel]?.setController(event.number, event.value);
                break;
            case 'Pitch Bend':
                this.#players[event.channel]?.setPitchBend?.(event.value);
                break;
            case 'Program Change':
                if(event.channel == 10 || event.value === 247) break;
                if(!this.#opts.presetAuto && !this.#opts.presetRandom) break;
                if(this.#players[event.channel] !== undefined && this.#players[event.channel].preset.program != (event.value + 1)) {
                    this.#players[event.channel].preset = this.#instruments[event.value + 1];
                }
                break;
            case 'Karaoke Event':
                this.triggerPlayerEvent('karaoke', event.text);
                break;
        }
    }


    #addNote(channel, note, envelope) {
        if (!this.#activeNotes[channel]) this.#activeNotes[channel] = new Map();
        this.#activeNotes[channel].set(note, envelope);
        this.#updateChannelStates();
        const realDurationMs = (envelope.duration || 0) * 1000;
        envelope.cleanupTimer = setTimeout(() => {
            if (this.#activeNotes[channel]?.get(note) === envelope) {
                this.#activeNotes[channel].delete(note);
                this.#updateChannelStates();
            }
        }, realDurationMs + 50);
    }


    #stopNote(channel, noteNumber) {
        const player = this.#players[channel];
        const envelope = this.#activeNotes[channel]?.get(noteNumber);
        if (envelope) {
            if (envelope.cleanupTimer) clearTimeout(envelope.cleanupTimer);
            const removeNoteFromRegistry = () => {
                this.#activeNotes[channel]?.delete(noteNumber);
                this.#updateChannelStates();
            };
            if (player && player.isSustainActive()) {
                player.registerSustainNote(() => envelope.cancel(false));
            } else {
                envelope.cancel(false);
            }
            removeNoteFromRegistry();
        }
    }


    #clearActiveNotes() {
        Object.keys(this.#activeNotes).forEach(channel => {
            this.#activeNotes[channel].forEach((envelope, note) => {
                if (envelope) {
                    if (envelope.cleanupTimer) clearTimeout(envelope.cleanupTimer);
                    if (envelope.cancel) envelope.cancel(true);
                }
                this.#activeNotes[channel]?.delete(note);
            });
        });
        this.#updateChannelStates();
    }


    #updateChannelStates() {
        let hasChanged = false;
        const nextStates = {};
        Object.keys(this.#players).forEach(channel => {
            const isActive = Boolean(this.#activeNotes[channel]?.size && this.#activeNotes[channel].size > 0);
            nextStates[channel] = isActive;
            if (this.#channelStates[channel] !== isActive) hasChanged = true;
        });
        if (hasChanged) {
            this.#channelStates = nextStates;
            this.triggerPlayerEvent('channelState', this.#channelStates);
        }
    }


    async extractLyrics() {
        const structure = { language: "", title: "", paragraphs: [] };
        let bestTrack = null;
        let maxTextEventsCount = 0;

        this.events.forEach(track => {
            const textEventsInTrack = track.filter(e => e.name === 'Text Event' || e.name === 'Lyric Event');
            const realLyricsCount = textEventsInTrack.filter(e => e.string && !e.string.startsWith('@')).length;
            if (realLyricsCount > maxTextEventsCount) {
                maxTextEventsCount = realLyricsCount;
                bestTrack = textEventsInTrack;
            }
        });

        if (!bestTrack || bestTrack.length === 0) return structure;
        const allTextEvents = bestTrack.sort((a, b) => a.tick - b.tick);

        let paragraphs = [];
        let currentParaLines = [];
        let currentLineBlocks = [];
        let lastBlockTick = 0;

        allTextEvents.forEach(event => {
            let text = event.string || "";
            if (!text) return;
            if (text.startsWith('@L')) {
                structure.language = text.substring(2).trim();
                return;
            }
            if (text.startsWith('@T')) {
                structure.title += (structure.title ? ' / ' : '') + text.substring(2).trim();
                return;
            }
            if (text.startsWith('@') ||
                text.startsWith('(') ||
                text.startsWith('PART') ||
                /^\d+\s+\d+/.test(text.trim())) {
                return;
            }
            const isNewParagraphMarker = text.startsWith('\\');
            const isNewLineMarker = text.startsWith('/');
            if (isNewParagraphMarker || isNewLineMarker) {
                text = text.substring(1);
            }
            text = text.replace(/[\r\n]/g, "");
            let isTimeGapTrigger = false;
            if (lastBlockTick > 0 && event.tick > lastBlockTick) {
                const secondsSilence = this.ticksToSeconds(lastBlockTick, event.tick);
                if (secondsSilence > 2.5) {
                    isTimeGapTrigger = true;
                }
            }
            if (isNewLineMarker || isNewParagraphMarker || isTimeGapTrigger) {
                if (currentLineBlocks.length > 0) {
                    currentParaLines.push({
                        tick: currentLineBlocks[0].tick,
                        blocks: currentLineBlocks
                    });
                    currentLineBlocks = [];
                }
                if (currentParaLines.length > 0) {
                    const isMaxLinesReached = currentParaLines.length >= 4;
                    if (isNewParagraphMarker || isTimeGapTrigger || isMaxLinesReached) {
                        paragraphs.push({
                            tick: currentParaLines[0].tick,
                            lines: currentParaLines
                        });
                        currentParaLines = [];
                    }
                }
            }
            if (text.length > 0) {
                currentLineBlocks.push({
                    text: text,
                    tick: event.tick
                });
                lastBlockTick = event.tick;
            }
        });
        if (currentLineBlocks.length > 0) {
            currentParaLines.push({
                tick: currentLineBlocks[0].tick,
                blocks: currentLineBlocks
            });
        }
        if (currentParaLines.length > 0) {
            paragraphs.push({
                tick: currentParaLines[0].tick,
                lines: currentParaLines
            });
        }
        structure.paragraphs = paragraphs;
        return structure;
    }



    async generateKaraokeFrames() {
        const lyrics = await this.extractLyrics();
        if (!lyrics.paragraphs.length) {
            this.events[0].push({
                text: `<span class="karaoke-intro"></span>`,
                name: 'Karaoke Event',
                tick: 0,
            });
            this.events[0] = this.events[0].sort((a, b) => a.tick - b.tick);
            return;
        }
        this.#title = lyrics.title.replace(/ \/ /g, '<br>');
        // this.triggerPlayerEvent('karaoke', `<span class="karaoke-title">${this.#title}</span>`);
        // this.triggerPlayerEvent('karaoke', `<span class="karaoke-clear"></span>`);
        let lastFrameEnd = 0;
        const delayTicks = this.secondsToTicks(this.#opts.karaokeDelay);
        const threeSecondsInTicks = this.secondsToTicks(3);
        const fiveSecondsInTicks = this.secondsToTicks(5);
        const sevenSecondsInTicks = this.secondsToTicks(7);
        const tenSecondsInTicks = this.secondsToTicks(10);
        const allBlocksInSong = [];
        lyrics.paragraphs.forEach((p, pIdx) => {
            p.lines.forEach((l, lIdx) => {
                l.blocks.forEach(b => {
                    allBlocksInSong.push({
                        block: b,
                        lineIdx: lIdx,
                        paraIdx: pIdx,
                        paragraph: p,
                        fastLinesText: p.lines.map(li => li.blocks.map(bl => bl.text).join(''))
                    });
                });
            });
        });
        const paragraphDisplayTicks = [];
        lyrics.paragraphs.forEach((p, pIdx) => {
            let paragraphDisplayTick = this.getTickBeforeSeconds(p.tick, 5);
            if (paragraphDisplayTick < lastFrameEnd) {
                paragraphDisplayTick = lastFrameEnd + ((p.tick - lastFrameEnd) / 2);
            }
            if (pIdx === 0 && paragraphDisplayTick < 20) {
                paragraphDisplayTick = 20;
            }
            paragraphDisplayTicks[pIdx] = paragraphDisplayTick;
            const fastLinesText = p.lines.map(li => li.blocks.map(b => b.text).join(''));
            const initialHTML = fastLinesText
                .map(lineText => `<span class="karaoke-coming">${lineText}</span>`)
                .join('<br/>');
            this.events[0].push({
                text: initialHTML,
                name: 'Karaoke Event',
                tick: paragraphDisplayTick,
            });
            if (p.lines.length > 0) {
                const lastLine = p.lines[p.lines.length - 1];
                if (lastLine.blocks.length > 0) {
                    lastFrameEnd = lastLine.blocks[lastLine.blocks.length - 1].tick;
                }
            }
        });
        const firstParaDisplayTick = paragraphDisplayTicks[0] || 0;
        if (firstParaDisplayTick > 25) {
            this.events[0].push({
                text: `<span class="karaoke-clear"></span>`,
                name: 'Karaoke Event',
                tick: 5,
            });
        }
        allBlocksInSong.forEach((current, index) => {
            const currentBlock = current.block;
            const currentLineIdx = current.lineIdx;
            const currentParaIdx = current.paraIdx;
            const p = current.paragraph;
            const fastLinesText = current.fastLinesText;
            const generateHTML = (forceAllPlayedOnActiveLine = false) => {
                return p.lines.map((li, liIdx) => {
                    if (liIdx < currentLineIdx) {
                        return `<span class="karaoke-played">${fastLinesText[liIdx]}</span>`;
                    }
                    if (liIdx > currentLineIdx) {
                        return `<span class="karaoke-coming">${fastLinesText[liIdx]}</span>`;
                    }
                    let lineHTML = '';
                    li.blocks.forEach(block => {
                        let className = 'coming';
                        if (forceAllPlayedOnActiveLine || block.tick < currentBlock.tick) {
                            className = 'played';
                        } else if (block.tick === currentBlock.tick) {
                            className = 'playing';
                        }
                        lineHTML += `<span class="karaoke-${className}">${block.text}</span>`;
                    });
                    return lineHTML;
                }).join('<br>');
            };
            this.events[0].push({
                text: generateHTML(false),
                name: 'Karaoke Event',
                tick: currentBlock.tick - delayTicks,
            });
            const next = allBlocksInSong[index + 1];
            if (next) {
                const tickDifference = next.block.tick - currentBlock.tick;

                if (tickDifference > threeSecondsInTicks) {
                    let targetCleanupTick = currentBlock.tick + threeSecondsInTicks;
                    let targetClearTick = currentBlock.tick + sevenSecondsInTicks;
                    let shouldAddClear = tickDifference > tenSecondsInTicks && currentParaIdx > 0;
                    if (next.paraIdx !== currentParaIdx) {
                        const nextParaDisplayTick = paragraphDisplayTicks[next.paraIdx];
                        if (targetCleanupTick >= nextParaDisplayTick) {
                            targetCleanupTick = nextParaDisplayTick - 1;
                        }
                        if (shouldAddClear) {
                            if (targetClearTick >= nextParaDisplayTick || (nextParaDisplayTick - targetClearTick) < threeSecondsInTicks) {
                                shouldAddClear = false;
                            }
                        }
                    }
                    if (targetCleanupTick > currentBlock.tick) {
                        this.events[0].push({
                            text: generateHTML(true),
                            name: 'Karaoke Event',
                            tick: targetCleanupTick - delayTicks,
                        });
                    }
                    if (shouldAddClear && targetClearTick > targetCleanupTick) {
                        this.events[0].push({
                            text: `<span class="karaoke-clear"></span>`,
                            name: 'Karaoke Event',
                            tick: targetClearTick - delayTicks,
                        });
                    }
                }
            }
            lastFrameEnd = currentBlock.tick;
        });
        if ((this.totalTicks - lastFrameEnd) > this.secondsToTicks(5)) {
            this.events[0].push({
                text: `<span class="karaoke-clear"></span>`,
                name: 'Karaoke Event',
                tick: lastFrameEnd + this.secondsToTicks(5),
            });
        } else {
            this.events[0].push({
                text: `<span class="karaoke-clear"></span>`,
                name: 'Karaoke Event',
                tick: this.totalTicks - 1,
            });
        }
        this.events[0] = this.events[0].sort((a, b) => a.tick - b.tick);
    }


    #log(str, err = false) {
        this.triggerPlayerEvent('logs', str);
    }

}