const formatTime = (secondsFloat) => {
    const totalSeconds = Math.floor(secondsFloat);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
const create = (tag, classname=null, content=null, attrs={}) => {
    const elm = document.createElement(tag);
    if(classname) elm.className = classname;
    if(content) elm.innerHTML = content;
	Object.entries(attrs).forEach(a => elm.setAttribute(a[0], a[1]));
    return elm;
};
HTMLElement.prototype.create = function(tag, classname=null, content=null, attrs={}) {
    const elm = create(tag, classname, content, attrs);
    this.append(elm);
    return elm;
};




(async () => {
	const song = '../../data/enberne.mid';

	const logs = document.querySelector('.logs');
	const btnplay = document.querySelector('.btn.play');
	const btnstop = document.querySelector('.btn.stop');
	const btnpause = document.querySelector('.btn.pause');

	const log = async (str) => {
		const now = new Date();
		const formatted = new Intl.DateTimeFormat('en-CA', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		}).format(now).replace(/,/g, '');
		if(logs.innerText) logs.innerText += "\n";
		logs.innerText += `[${formatted}] ${str}`;
		logs.scrollTop = logs.scrollHeight;
	}


	btnplay.addEventListener('click', async () => {
		[btnpause, btnstop].forEach(btn => btn.classList.remove('active'));
		btnplay.classList.add('active');
		await player.play();
		log(player.getCurrentTick() ? "Resume" : "Play");
	});

	btnstop.addEventListener('click', () => {
		[btnpause, btnplay].forEach(btn => btn.classList.remove('active'));
		btnstop.classList.add('active');
		player.stop();
		waveform.style.setProperty('--progress', `0%`);
		waveform.style.setProperty('--time', `"0:00"`);
		log("Stop");
	});

	btnpause.addEventListener('click', () => {
		if(!player.isPlaying()) return log("Not playing");
		[btnstop, btnplay].forEach(btn => btn.classList.remove('active'));
		btnpause.classList.add('active');
		player.pause();
		log("Pause");
	});


	log("Initializing player...");
	let songInfos = null;
	const waveform = document.querySelector('.waveform');
	const player = new MidiAudioPlayer({
		volume: localStorage.getItem('waf_volume') || 0.7,
		reverb: 0.2,
		presetRandom: true,
		presetAuto: true,
		localCache: true,
		presets: {
			// [-1]: '12805_Chaos'
		}
	});
	player.on('endOfFile', async () => {
		[btnpause, btnplay].forEach(btn => btn.classList.remove('active'));
		btnstop.classList.add('active');
		waveform.style.setProperty('--progress', `0%`);
		waveform.style.setProperty('--time', `"0:00"`);
		log("End of file");
	});
	player.on('fileLoaded', async (data) => {
		songInfos = data;
		log("Generating waveform...");
		const svgCode = await player.generateWaveformSVG();
		waveform.style.setProperty('--progress', `0%`);
		waveform.style.setProperty('--time', `"0:00"`);
		waveform.style.setProperty('--duration', `"${formatTime(songInfos.duration)}"`);
		document.querySelector('.waveform__container').innerHTML = svgCode;
	});
	player.on('logs', str => log(str));
	document.querySelector('.waveform__click').addEventListener('click', async event => {
		const rect = event.currentTarget.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const ratio = x / rect.width;
		const finalRatio = Math.max(0, Math.min(1, ratio));
		await player.skipToTick(songInfos.totalTicks * finalRatio);
		[btnpause, btnstop].forEach(btn => btn.classList.remove('active'));
		btnplay.classList.add('active');
		player.play();
	});


	const input = document.querySelector('.dbvol__input');
	const svg = document.querySelector('.dbvol__svg');
	input.value = 100 - (player.volume * 100);
	input.addEventListener('input', (e) => {
		const val = 100 - parseFloat(e.target.value);
		const railTop = 20;
		const railBottom = 365;
		const travelDistance = railBottom - railTop;
		const newY = railBottom - (val / 100 * travelDistance);
		svg.style.setProperty('--y', newY + 'px');
		player.volume = val / 100;
		localStorage.setItem(`waf_volume`, player.volume);
	});
	input.dispatchEvent(new Event('input', {bubbles: true, cancelable: false }));


	let lasttime = 0;
	let lastmeter = 0;
	let lastprogress = '0:00';
	setInterval(async () => {
		requestAnimationFrame(async () => {
			const tick = player.getCurrentTick();
			if(tick) {
				const time = (songInfos.duration - player.getSongTimeRemaining()).toFixed(3);
				if(time != lasttime) {
					waveform.style.setProperty('--progress', `${time / songInfos.duration * 100}%`);
					const progress = formatTime(time);
					if(progress != lastprogress){
						waveform.style.setProperty('--time', `"${progress}"`);
						lastprogress = progress;
					}
					lasttime = time;
				}
			}

			const vol = await player.getRealTimeVolume() * 1.8;
			const indic = Math.ceil(vol * 36);
			if(indic == lastmeter) return;
			document.querySelectorAll(`.meter svg .meter__bands > .meter__band:nth-last-child(-n + ${indic})`).forEach(async elm => elm.style.opacity = 1);
			document.querySelectorAll(`.meter svg .meter__bands > .meter__band:nth-last-child(n + ${indic + 1})`).forEach(async elm => elm.style.opacity = 0.3);
			lastmeter = indic;
		});
	}, 50);



	log("Downloading song...");
	const response = await fetch(song);
	const buffer = await response.arrayBuffer();
	const infos = await player.load(buffer);

	log("Ready");
	document.querySelector('.controls').classList.remove('disabled');
	document.querySelector('.waveform').classList.remove('disabled');
})();

