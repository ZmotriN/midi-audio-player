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
	// const song = 'https://zmotrin.github.io/midi-audio-player/data/nevergonnagiveyouup.mid';
	const song = 'https://zmotrin.github.io/midi-audio-player/data/iwillsurvive.mid';
	
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
	let player = null;
	await new Promise(resolve => {
		player = new MidiAudioPlayer({
			presetRandom: true,
			onEndFile: async () => {
				[btnpause, btnplay].forEach(btn => btn.classList.remove('active'));
				btnstop.classList.add('active');
				log("End of file");
			}
		}, resolve);
	});
	log("Player initialized!");

	// console.log(await player.getCatalog());

	log("Download song...");
	const response = await fetch(song);

	log("Loading Buffer...");
	const buffer = await response.arrayBuffer();
	await player.load(buffer);

	log("Ready!");




})();

