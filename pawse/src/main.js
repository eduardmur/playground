import { Game } from './game.js';

const canvas = document.getElementById('scene');
let game = null;

function start(saved) {
  game = new Game(canvas, saved);
  window.game = game;
  game.start();
}

// When the page is hosted somewhere that can swap in a newer version while it is
// open, hand the running state (time of day, where the dog is) across the swap.
const hot = window.claude?.hot;
try {
  hot?.snapshot?.(() => game?.snapshot());
} catch {
  /* optional */
}
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? null);
