/** The small pleasures of a day at the park. There is no score; these are just things to notice. */
export const JOYS = [
  { id: 'friend', icon: '♥', title: 'A new friend', text: 'You said hello, nose to nose.', hint: 'Walk up to another dog and say hello.' },
  { id: 'treat', icon: '✦', title: 'Crunch', text: 'A biscuit, found in the grass.', hint: 'Something tasty is glinting nearby.' },
  { id: 'drink', icon: '≈', title: 'A cool drink', text: 'Water never tasted so good.', hint: 'Find water when you are thirsty.' },
  { id: 'birds', icon: '➶', title: 'Pigeon patrol', text: 'Up they went, all at once.', hint: 'Those birds look very chaseable.' },
  { id: 'tricks', icon: '★', title: 'Good dog', text: 'Five different tricks. Very good dog.', hint: 'Show off a few different tricks.' },
  { id: 'swim', icon: '∿', title: 'Splash', text: 'The pond is yours.', hint: 'The pond looks inviting.' },
  { id: 'shake', icon: '⁂', title: 'Shake it off', text: 'Everything nearby is now damp.', hint: 'Wet fur wants shaking.' },
  { id: 'tag', icon: '➳', title: "Tag, you're it", text: 'Round and round you went.', hint: 'Play-bow to a dog to start a game.' },
  { id: 'fetch', icon: '●', title: 'Fetch, backwards', text: 'You threw. They fetched.', hint: 'Toss the ball when a friend is near.' },
  { id: 'copycat', icon: '❞', title: 'Copycat', text: 'A friend copied your trick.', hint: 'Friends watch what you do.' },
  { id: 'flowers', icon: '✿', title: 'Smell the flowers', text: 'You stopped. You sniffed. It was worth it.', hint: 'The flowers are worth a sniff.' },
  { id: 'butterfly', icon: 'ʚ', title: 'Flutter', text: 'Nearly caught it. Nearly.', hint: 'Something is fluttering over the flowers.' },
  { id: 'zoomies', icon: '»', title: 'Zoomies', text: 'For no reason at all.', hint: 'Run, and keep running.' },
  { id: 'hill', icon: '▲', title: 'Top of the world', text: 'You can see the whole park from up here.', hint: 'Climb to the old oak.' },
  { id: 'sunset', icon: '◐', title: 'Golden hour', text: 'You sat and watched the sun go down.', hint: 'Sit for a while as the sun sets.' },
  { id: 'nap', icon: 'z', title: 'Forty winks', text: 'A nap in the grass.', hint: 'Lie down and stay a while.' },
  { id: 'stick', icon: '⌇', title: 'The best stick', text: 'It is a very good stick and it is yours.', hint: 'There are sticks under the trees.' },
  { id: 'dig', icon: '⛏', title: 'Buried treasure', text: 'You knew something was down there.', hint: 'Fresh earth is worth a dig.' },
  { id: 'island', icon: '◉', title: 'Castaway', text: 'An island, all to yourself.', hint: 'There is an island in the pond.' },
  { id: 'fireflies', icon: '·', title: 'Little lanterns', text: 'The fireflies came out.', hint: 'Stay out after dark.' },
  { id: 'howl', icon: '☾', title: 'Moon song', text: 'You sang to the moon.', hint: 'The night is a good time to howl.' },
  { id: 'choir', icon: '♪', title: 'The choir', text: 'Everyone joined in.', hint: 'Howl with friends close by.' },
  { id: 'shy', icon: '❀', title: 'Patience', text: 'Miso came to you, in her own time.', hint: 'One dog is shy. Be calm and still nearby.' },
  { id: 'treats10', icon: '✧', title: 'Snack connoisseur', text: 'Ten biscuits. Who is counting? You are.', hint: 'Keep an eye out for biscuits.' },
  { id: 'gold', icon: '❂', title: 'Treasure hunter', text: 'All five golden bones.', hint: 'Golden bones hide in far corners.' },
  { id: 'allFriends', icon: '❤', title: "Everyone's friend", text: 'The whole park knows your name.', hint: 'Befriend every dog in the park.' },
  { id: 'dawn', icon: '☼', title: 'Early bird', text: 'You were there when the sun came up.', hint: 'See the night through to morning.' },
];

const KEY = 'pawse.save.v1';

/** Tiny persistent save: joys found, friends made, a few counters and settings. */
export class Save {
  constructor() {
    this.data = { joys: [], friends: [], gold: [], treats: 0, breed: 'shiba', music: true, sound: true };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch {
      /* private mode: play without saving */
    }
  }

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  reset() {
    this.data = { ...this.data, joys: [], friends: [], gold: [], treats: 0 };
    this.write();
  }
}

export class Joys {
  constructor(save, onUnlock) {
    this.save = save;
    this.onUnlock = onUnlock;
    this.found = new Set(save.data.joys);
  }

  has(id) {
    return this.found.has(id);
  }

  unlock(id) {
    if (this.found.has(id)) return false;
    const joy = JOYS.find((j) => j.id === id);
    if (!joy) return false;
    this.found.add(id);
    this.save.data.joys = [...this.found];
    this.save.write();
    this.onUnlock?.(joy);
    return true;
  }

  get count() {
    return this.found.size;
  }
}
