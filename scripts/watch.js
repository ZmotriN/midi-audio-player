import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';
import { join } from 'path';

// 1. Récupération des données dynamiques
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const version = pkg.version;
const date = new Date().toISOString().replace('T', ' ').substring(0, 19);

// 2. Lecture et transformation de la bannière
let bannerText = readFileSync(join(process.cwd(), '/scripts/banner.txt'), 'utf8');
bannerText = bannerText
  .replace('###VERSION###', version)
  .replace('###DATE###', date);

const entryPoint = 'index.js';
const globalName = 'MidiAudioPlayer';

const isBuildMode = process.argv.includes('--build');

const sharedConfig = {
  entryPoints: [entryPoint],
  bundle: true,
  treeShaking: true,
  sourcemap: true,
  logLevel: 'info',
  target: ['es2022'],
  // On injecte la bannière ici pour qu'elle s'applique à tous les formats
  banner: {
    js: bannerText,
  },
};

const formats = [
  { format: 'esm', outfile: 'dist/index.js' },
  { format: 'esm', minify: true, outfile: 'dist/index.mjs' },
  { format: 'iife', outfile: 'dist/midi-audio-player.js', globalName },
  { format: 'iife', minify: true, outfile: 'dist/midi-audio-player.min.js', globalName },
];

async function run() {
  try {
    if (isBuildMode) {
      console.log('🚀 Construction des bundles avec bannière...');
      await Promise.all(
        formats.map(config => esbuild.build({ ...sharedConfig, ...config }))
      );
      console.log('✅ Build terminé avec succès !');
    } else {
      console.log('👀 Initialisation du watcher (bannière incluse)...');
      const contexts = await Promise.all(
        formats.map(config => esbuild.context({ ...sharedConfig, ...config }))
      );

      await Promise.all(contexts.map(ctx => ctx.watch()));
      console.log('👀 Watcher actif !');
    }
  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
}

run();