(async () => {
	const player = new MidiAudioPlayer();
	const response = await fetch('https://zmotrin.github.io/midi-audio-player/data/iwillsurvive.mid');
	const buffer = await response.arrayBuffer();

	const btnplay = document.querySelector('.btn.play');
	const btnstop = document.querySelector('.btn.stop')
	const btnpause = document.querySelector('.btn.pause')

	btnplay.addEventListener('click', () => {
		[btnpause, btnstop].forEach(btn => btn.classList.remove('active'));
		btnplay.classList.add('active');
		player.play(buffer);
	});

	btnstop.addEventListener('click', () => {
		[btnpause, btnplay].forEach(btn => btn.classList.remove('active'));
		btnstop.classList.add('active');
		player.stop();
	});

})();

