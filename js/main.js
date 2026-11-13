// Scene manager. To add a scene: create js/scenes/<name>.js and register it below.
import { state } from './state.js';
import { lobbyScene } from './scenes/lobby.js';
import { boothScene } from './scenes/booth.js';

const scenes = {
  lobby: lobbyScene,
  booth: boothScene,
  // print: printScene, envelope: envelopeScene, plane: planeScene,
  // globe: globeScene, finale: finaleScene,
};

const root = document.getElementById('app');
let current = null;

function go(name) {
  if (!scenes[name]) throw new Error(`Unknown scene: ${name}`);
  if (current) current.unmount();
  current = scenes[name];
  current.mount(root, { go, state });
}

go('lobby');
