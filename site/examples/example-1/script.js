(async () => {
	const player = new MidiAudioPlayer();
	const response = await fetch('https://zmotrin.github.io/midi-audio-player/data/iwillsurvive.mid');
	const buffer = await response.arrayBuffer();


	document.querySelector('.btn.play').addEventListener('click', e => {
		e.target.classList.add('active');
		player.play(buffer);
	});

})();

