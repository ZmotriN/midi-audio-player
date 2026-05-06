import fs from 'fs/promises';
import path from 'path';


export async function downloadWebAudioFont(id, filename) {
    const cleanFilename = filename.endsWith('.json') ? filename : `${filename}.json`;
    const destPath = path.join(process.cwd(), cleanFilename);
    const url = `https://surikov.github.io/webaudiofontdata/sound/${id}.js`;

    try {
        console.log(`📡 Téléchargement de : ${id}...`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erreur HTTP: ${response.status} (Vérifiez l'ID)`);

        const rawContent = await response.text();
        const firstBrace = rawContent.indexOf('{');
        const lastBrace = rawContent.lastIndexOf('}');

        if (firstBrace === -1 || lastBrace === -1) throw new Error("Format de fichier invalide : structure d'objet introuvable.");

        const objectString = rawContent.substring(firstBrace, lastBrace + 1);
        const data = new Function(`return ${objectString}`)();
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, JSON.stringify(data, null, 2));

        console.log(`✅ Terminé ! Fichier créé : ${destPath}`);
        return data;
        
    } catch (error) {
        console.error(`❌ Échec : ${error.message}`);
        throw error;
    }
}