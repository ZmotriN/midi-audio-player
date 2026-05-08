import * as esbuild from 'esbuild';

const entryPoint = 'index.js';
const globalName = 'MidiAudioPlayer';

const sharedConfig = {
  entryPoints: [entryPoint],
  bundle: true,
  treeShaking: true,
  sourcemap: true,
  logLevel: 'info',
};

async function start() {
  try {
    // 1. ESM - Standard (pour les bundlers comme Vite/Webpack)
    const ctxEsm = await esbuild.context({
      ...sharedConfig,
      format: 'esm',
      outfile: 'dist/index.js',
    });

    // 2. ESM Minifié (pour charger via <script type="module"> depuis un CDN)
    const ctxEsmMin = await esbuild.context({
      ...sharedConfig,
      format: 'esm',
      minify: true,
      outfile: 'dist/index.mjs',
    });

    // 3. IIFE - Standard (Navigateur classique)
    const ctxIife = await esbuild.context({
      ...sharedConfig,
      format: 'iife',
      globalName: globalName,
      outfile: 'dist/midi-audio-player.js',
    });

    // 4. IIFE Minifié (Navigateur classique - Production)
    const ctxIifeMin = await esbuild.context({
      ...sharedConfig,
      format: 'iife',
      globalName: globalName,
      minify: true,
      outfile: 'dist/midi-audio-player.min.js',
    });

    // Lancement simultané des 4 processus de surveillance
    await Promise.all([
      ctxEsm.watch(),
      ctxEsmMin.watch(),
      ctxIife.watch(),
      ctxIifeMin.watch()
    ]);

    console.log('👀 Watcher actif sur 4 formats :');
    console.log('   - ESM: dist/index.js & dist/index.mjs');
    console.log('   - IIFE: dist/midi-audio-player.js & .min.js');
    
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
    process.exit(1);
  }
}

start();