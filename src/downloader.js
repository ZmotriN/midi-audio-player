import fs from 'fs/promises';
import path from 'path';

/**
 * Télécharge une police audio WebAudioFont et la convertit en JSON
 * @param {string} id - L'ID de la police (ex: "0810_GeneralUserGS_sf2_file")
 * @param {string} filename - Le nom du fichier de sortie (ex: "ma_police.json")
 */
export async function downloadWebAudioFont(id, filename) {
    // Nettoyage du nom de fichier : s'assurer qu'il finit par .json
    const cleanFilename = filename.endsWith('.json') ? filename : `${filename}.json`;
    
    // On définit la destination par rapport au dossier de travail actuel
    const destPath = path.join(process.cwd(), cleanFilename);
    const url = `https://surikov.github.io/webaudiofontdata/sound/${id}.js`;

    try {
        console.log(`📡 Téléchargement de : ${id}...`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status} (Vérifiez l'ID)`);
        }

        const rawContent = await response.text();

        // Extraction de l'objet JS entre les premières '{' et les dernières '}'
        const firstBrace = rawContent.indexOf('{');
        const lastBrace = rawContent.lastIndexOf('}');

        if (firstBrace === -1 || lastBrace === -1) {
            throw new Error("Format de fichier invalide : structure d'objet introuvable.");
        }

        const objectString = rawContent.substring(firstBrace, lastBrace + 1);

        // Transformation de la chaîne en objet JavaScript
        const data = new Function(`return ${objectString}`)();

        // Création du dossier parent s'il n'existe pas
        await fs.mkdir(path.dirname(destPath), { recursive: true });

        // Sauvegarde en format JSON
        await fs.writeFile(destPath, JSON.stringify(data, null, 2));

        console.log(`✅ Terminé ! Fichier créé : ${destPath}`);
        return data; // Retourne l'objet au cas où on veut l'utiliser immédiatement
        
    } catch (error) {
        console.error(`❌ Échec : ${error.message}`);
        throw error; // On relance l'erreur pour que l'appelant puisse la gérer
    }
}