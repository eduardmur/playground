import { Game } from './game.js';

const canvas = document.getElementById('scene');
const game = new Game(canvas);
window.game = game;
game.start();
