import '@fontsource-variable/geist';
import './style.css';
import { App } from './app';
import { Audio } from './audio/engine';
import { Timer } from './core/timer';
import { Hud } from './ui/hud';
import { settings, save } from './core/settings';

const params = new URLSearchParams(location.search);
const app = new App(document.getElementById('scene') as HTMLCanvasElement);
const audio = new Audio();
const timer = new Timer();

// as it was left
if (!params.has('t')) app.hour = settings.hour;
app.drift = settings.drift;
audio.volRadio = settings.volRadio;
audio.volTrain = settings.volTrain;
audio.muted = settings.muted;
audio.radioOn = settings.radio;
audio.setStation(settings.station, false);

const hud = new Hud(app, audio, timer);

timer.onEnd = (finished) => audio.chime(finished === 'focus' ? 'focus' : 'break');
app.on((what, value) => {
  if (what === 'hour') {
    settings.hour = Math.round(value * 100) / 100;
    save();
  }
});

// browsers allow no sound until the page has been touched
const wake = () => {
  audio.start();
  window.removeEventListener('pointerdown', wake);
  window.removeEventListener('keydown', wake);
};
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);

let slow = 0;
app.onFrame = (dt) => {
  audio.update({ tunnel: app.tunnel, bridge: app.bridge, lean: app.lean, speed: app.speed }, dt);
  slow += dt;
  if (slow > 0.25) {
    slow = 0;
    timer.tick();
    hud.tick();
  }
};
// the timer keeps time when the tab is in the background and frames stop
window.setInterval(() => timer.tick(), 1000);

Object.assign(window, { game: app, audio, timer });
app.start();
