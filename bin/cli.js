#!/usr/bin/env node

import { downloadWebAudioFont } from '../src/downloader.js';

// Récupération des arguments (ex: node cli.js <id> <destination>)
// process.argv[0] est Node, process.argv[1] est le chemin du script
const [id, destination] = process.argv.slice(2);

if (!id || !destination) {
    console.error("\x1b[31m%s\x1b[0m", "Erreur : Arguments manquants.");
    console.log("\nUsage :");
    console.log("  webaudiofont <id> <destination.json>");
    console.log("\nExemple :");
    console.log("  webaudiofont 0810_GeneralUserGS_sf2_file assets/sound.json\n");
    process.exit(1);
}

async function run() {
    try {
        await downloadWebAudioFont(id, destination);
    } catch (error) {
        // L'erreur est déjà logguée dans downloadWebAudioFont, on quitte proprement
        process.exit(1);
    }
}

run();