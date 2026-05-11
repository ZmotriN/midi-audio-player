self.create = (tag, classname=null, content=null, attrs={}) => {
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




	const song = 'https://zmotrin.github.io/midi-audio-player/data/iwillsurvive.mid';
	const btnplay = document.querySelector('.btn.play');
	const btnstop = document.querySelector('.btn.stop')
	const btnpause = document.querySelector('.btn.pause')
	const logs = document.querySelector('.logs');

	const instruments = {};
	instruments[MidiAudioPlayer.PIANO] = document.querySelector('#channel-piano');
	instruments[MidiAudioPlayer.BASS] = document.querySelector('#channel-bass');
	instruments[MidiAudioPlayer.STRINGS] = document.querySelector('#channel-strings');
	instruments[MidiAudioPlayer.SYNTH] = document.querySelector('#channel-synth');
	instruments[MidiAudioPlayer.DRUM] = document.querySelector('#channel-drum');


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


	btnplay.addEventListener('click', () => {
		[btnpause, btnstop].forEach(btn => btn.classList.remove('active'));
		btnplay.classList.add('active');
		player.play();
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


	// log("Loading preset...");
	// const preset =


	log("Initializing player...");
	const player = new MidiAudioPlayer({
		onEndFile: async () => {
			[btnpause, btnplay].forEach(btn => {
				btn.classList.remove('active');
			});
			btnstop.classList.add('active');
			log("End of file");
		}
	});

	log("Loading catalog...");
	const categories = await player.getCategories();
	
	Object.keys(instruments).forEach(async i => instruments[i].create('option', null, 'Default', { value: -1 }));
	categories.forEach(category => {
		instruments[category.channel].create('option', null, category.name, { disabled: true });
		category.instruments.forEach(inst => {
			
			const presets = inst.presets.sort((a, b) => a.bank.localeCompare(b.bank));
			presets.forEach(pre => instruments[category.channel].create('option', null, `${inst.name} ${pre.bank} #${pre.serie + 1}`, { value: pre.id }));
		});
	});

	Object.keys(instruments).forEach(i => {
		const sel = instruments[i];
		sel.addEventListener('change', async () => {
			console.log(sel.value);

			console.log(await player.getPreset(sel.value));

			log(`Loading preset: ${sel.options[sel.selectedIndex].text}`);
		});
	});



	log("Download song...");
	const response = await fetch(song);

	log("Loading Buffer...");
	const buffer = await response.arrayBuffer();
	await player.load(buffer);

	log("Ready!");


})();

