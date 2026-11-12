import { JOYS } from './joys.js';

const $ = (id) => document.getElementById(id);

/** The DOM overlay: title, HUD pills, prompts, toasts, the journal. */
export class UI {
  constructor(game) {
    this.game = game;
    this.panel = null;
    this.promptLabel = null;
    this.phase = '';
    this.photo = false;

    const click = (id, fn) =>
      $(id).addEventListener('click', (e) => {
        e.currentTarget.blur();
        fn(e);
      });
    click('begin', () => game.begin());
    click('prevBreed', () => game.cycleBreed(-1));
    click('nextBreed', () => game.cycleBreed(1));
    click('timeBtn', () => game.skipTime());
    click('holdBtn', () => game.toggleHold());
    click('joyBtn', () => this.togglePanel('journal'));
    click('musicBtn', () => game.toggleMusic());
    click('soundBtn', () => game.toggleSound());
    click('photoBtn', () => game.togglePhoto());
    click('helpBtn', () => this.togglePanel('help'));
    click('resetBtn', () => game.resetSave());

    // on-screen keys (tricks and touch buttons) feed the same input as the keyboard
    for (const b of document.querySelectorAll('#tricks button, #touchBtns button')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        game.audio.init();
        game.input.tap(b.dataset.key);
      });
    }
    for (const p of document.querySelectorAll('.panel')) {
      p.addEventListener('click', (e) => {
        if (e.target === p || e.target.hasAttribute('data-close')) this.closePanel();
      });
    }

    const stick = $('stick'), knob = $('stickKnob');
    game.input.onStick = (active, ox, oy, x, y) => {
      document.body.classList.add('touch');
      stick.classList.toggle('on', active);
      if (!active) return;
      stick.style.left = `${ox}px`;
      stick.style.top = `${oy}px`;
      const dx = x - ox, dy = y - oy, l = Math.hypot(dx, dy) || 1, k = Math.min(l, 56) / l;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    };
    window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
  }

  ready() {
    $('fade').classList.add('gone');
    $('title').hidden = false;
  }

  setBreed(breed) {
    $('breedName').textContent = breed.name;
    $('breedBlurb').textContent = breed.blurb;
  }

  startGame() {
    const title = $('title');
    title.classList.add('leaving');
    setTimeout(() => (title.hidden = true), 1150);
    const hud = $('hud');
    hud.hidden = false;
    requestAnimationFrame(() => hud.classList.add('on'));
    this.setJoyCount();
  }

  // ---------------------------------------------------------------- prompts

  setPrompt(label) {
    if (label === this.promptLabel) return;
    this.promptLabel = label;
    const el = $('prompt');
    if (label) $('promptText').textContent = label;
    el.classList.toggle('on', !!label);
  }

  flashKey(code) {
    const b = document.querySelector(`#tricks button[data-key="${code}"]`);
    if (!b) return;
    b.classList.add('hit');
    setTimeout(() => b.classList.remove('hit'), 260);
  }

  toast(text, ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this._showToast(el, ms);
  }

  joyToast(joy) {
    const el = document.createElement('div');
    el.className = 'toast joy';
    const ji = document.createElement('div');
    ji.className = 'ji';
    ji.textContent = joy.icon;
    const jt = document.createElement('div');
    jt.className = 'jt';
    jt.textContent = joy.title;
    const jd = document.createElement('div');
    jd.className = 'jd';
    jd.textContent = joy.text;
    el.append(ji, jt, jd);
    this._showToast(el, 5200);
    const btn = $('joyBtn');
    btn.classList.remove('bump');
    void btn.offsetWidth;
    btn.classList.add('bump');
    this.setJoyCount();
  }

  _showToast(el, ms) {
    const box = $('toasts');
    while (box.children.length > 2) box.firstChild.remove();
    box.append(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 750);
    }, ms);
  }

  setJoyCount() {
    $('joyCount').textContent = `${this.game.joys.count} / ${JOYS.length}`;
  }

  setTime(phase, night, held) {
    const key = `${phase}|${held}`;
    if (key === this.phase) return;
    this.phase = key;
    $('timeName').textContent = phase;
    $('timeIcon').textContent = night > 0.6 ? '☾' : phase === 'Dusk' || phase === 'Dawn' || phase === 'Sunset' ? '◐' : '☼';
    $('holdBtn').setAttribute('aria-pressed', String(held));
    $('holdBtn').title = held ? 'Time is standing still. Click to let it flow.' : 'Hold this moment';
  }

  setToggle(id, on) {
    $(id).setAttribute('aria-pressed', String(on));
  }

  // ----------------------------------------------------------------- panels

  togglePanel(name) {
    if (this.panel === name) this.closePanel();
    else this.openPanel(name);
  }

  openPanel(name) {
    this.closePanel();
    if (name === 'journal') this.renderJournal();
    $(name).hidden = false;
    this.panel = name;
    this.game.audio.sfx('click');
  }

  closePanel() {
    if (!this.panel) return;
    $(this.panel).hidden = true;
    this.panel = null;
  }

  renderJournal() {
    const g = this.game;
    const grid = $('joyGrid');
    grid.textContent = '';
    for (const joy of JOYS) {
      const found = g.joys.has(joy.id);
      const el = document.createElement('div');
      el.className = `joy${found ? ' found' : ''}`;
      const ji = document.createElement('div');
      ji.className = 'ji';
      ji.textContent = found ? joy.icon : '·';
      const jt = document.createElement('div');
      jt.className = 'jt';
      jt.textContent = found ? joy.title : '· · ·';
      const jd = document.createElement('div');
      jd.className = 'jd';
      jd.textContent = found ? joy.text : joy.hint;
      el.append(ji, jt, jd);
      grid.append(el);
    }
    $('journalSub').textContent = g.joys.count
      ? `${g.joys.count} of ${JOYS.length} found. Nothing to win, just things to notice.`
      : 'Nothing to win. Just things to notice.';
    const friends = g.npcs.filter((n) => n.friend).map((n) => n.name);
    const gold = g.save.gold.length;
    $('friendList').textContent =
      (friends.length ? `Friends: ${friends.join(', ')}` : 'No friends yet. Go and say hello.') +
      ` · Biscuits: ${g.save.treats}` + (gold ? ` · Golden bones: ${gold} of 5` : '');
  }

  setPhoto(on) {
    this.photo = on;
    $('hud').classList.toggle('photo', on);
    const hint = $('photoHint');
    if (on) {
      hint.classList.add('show');
      clearTimeout(this._ph);
      this._ph = setTimeout(() => hint.classList.remove('show'), 2600);
    } else {
      hint.classList.remove('show');
    }
  }
}
