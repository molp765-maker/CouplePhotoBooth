// Scene manager. To add a scene: create js/scenes/<name>.js and register it below.
import { state } from './state.js';
import { lobbyScene } from './scenes/lobby.js';
import { boothScene } from './scenes/booth.js';
import { watchScene } from './scenes/watch.js';

const scenes = {
  lobby: lobbyScene,
  booth: boothScene,
  watch: watchScene,
  // print: printScene, envelope: envelopeScene, plane: planeScene,
  // globe: globeScene, finale: finaleScene,
};

const root = document.getElementById('app');
let current = null;

function go(name, params = {}) {
  if (!scenes[name]) throw new Error(`Unknown scene: ${name}`);
  if (current) current.unmount();
  current = scenes[name];
  current.mount(root, { go: (n, p) => go(n, p), state, params });
}

const watchCode = new URLSearchParams(location.search).get('watch');
if (watchCode) go('watch', { code: watchCode }); else go('lobby');
