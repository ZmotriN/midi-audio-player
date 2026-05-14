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
	const song = '../../data/closer.mid';
	
	const logs = document.querySelector('.logs');
	const btnplay = document.querySelector('.btn.play');
	const btnstop = document.querySelector('.btn.stop')
	const btnpause = document.querySelector('.btn.pause')

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
	const player = new MidiAudioPlayer({
		presetRandom: true,
		presetAuto: true,
		presets: {
			// [-1]: '12805_Chaos'
		}
	});
	player.on('endOfFile', async () => {
		[btnpause, btnplay].forEach(btn => btn.classList.remove('active'));
		btnstop.classList.add('active');



		log("End of file");
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
	});
	input.dispatchEvent(new Event('input', {bubbles: true, cancelable: false }));








	let lastmeter = 0;
	setInterval(async () => {
		requestAnimationFrame(async () => {
			const vol = player.getRealTimeVolume() * 1.5;
			const indic = Math.ceil(vol * 36);
			if(indic == lastmeter) return;
			document.querySelectorAll(`.meter svg .meter__bands > .meter__band:nth-last-child(-n + ${indic})`).forEach(async elm => elm.style.opacity = 1);
			document.querySelectorAll(`.meter svg .meter__bands > .meter__band:nth-last-child(n + ${indic + 1})`).forEach(async elm => elm.style.opacity = 0.3);
			lastmeter = indic;
		});	
	}, 50);





		

		





			


			
			








	log("Player initialized!");


	log("Download song...");
	const response = await fetch(song);

	log("Loading Buffer...");
	const buffer = await response.arrayBuffer();
	const infos = await player.load(buffer);
	// console.log(infos);
	log("Ready!");

})();

