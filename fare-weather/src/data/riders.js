// Who rides, where they are going and what you overhear. Everyone in this city
// is a robot, the riders included; the car is the only one of them with no legs.
// This file is the script: the game reads it for subtitles and trip details, and
// scripts/build-prompts.mjs turns the same text into ElevenLabs prompts.
//
// Text in [square brackets] is a delivery cue for the voice model; it is never
// shown in subtitles.

/**
 * Voices. `design` is a prompt for ElevenLabs Voice Design. The riders are robots, but nobody in this
 * city sounds like one: the descriptions are of the people they sound like.
 */
export const VOICES = {
  nim: {
    name: 'Nim',
    role: 'the car',
    design:
      'The voice of a driverless taxi. Androgynous leaning female, early thirties, neutral American accent. Calm, warm and unhurried, with a hint of dry humour. Close, clear studio sound with no reverb, like a good in-car assistant: human, not robotic, never salesy.',
  },
  maya: { name: 'Maya', design: 'Woman, 28, American. Bright, quick and a little breathless, the nervous energy of someone who has just walked out of a job interview. Warm, expressive, laughs easily.' },
  okafor: { name: 'Mr. Okafor', design: 'Man, 67, Nigerian-American, gentle West African lilt. Deep, gravelly and unhurried: an old cab driver, long retired, who has heard everything. Amused, kind, speaks slowly and lets silences sit.' },
  priya: { name: 'Priya', design: 'Woman, 24, British Indian, London accent. Fast, teasing and sharp, voice slightly hoarse from shouting at a concert. Affectionate sarcasm.' },
  theo: { name: 'Theo', design: 'Man, 25, American. Deadpan and dry, low energy on the surface with real feeling underneath. Understated, slightly hoarse after a loud night.' },
  lena: { name: 'Lena', design: 'Woman, 41, American with a faint Eastern European accent. Soft, low and very tired after a fourteen-hour shift at a repair clinic, but warm. Speaks quietly, close to the microphone.' },
  gus: { name: 'Gus', design: 'Man, 34, American, New York edge. A working stand-up comic: big, fast, performative, always testing a line, with real insecurity right under it.' },
  june: { name: 'June', design: 'Woman, 72, American. A brisk, loving grandmother, an old model: clear, bright, a little bossy, with a chuckle in her voice. Slightly thin with age, perfectly sharp.' },
  sam: { name: 'Sam', design: 'Non-binary student, 20, American. Light, quick, anxious and likeable, words tumbling out, voice rising when panicked. Youthful.' },
  rafael: { name: 'Rafael', design: 'Man, 31, Mexican-American, slight Spanish warmth to the vowels. Soft-spoken and nervous, talking half to himself, breath a little short. Sincere.' },
  bea: { name: 'Bea', design: 'Woman, 58, Northern English (Yorkshire). Cheerful, curious and chatty, a delighted tourist who talks to everyone. Warm and round.' },
  tom: { name: 'Tom', design: 'Man, 60, Northern English (Yorkshire). Dry, patient, long-suffering and fond. Low, slow, wry.' },
  noor: { name: 'Noor', design: 'Woman, 29, American. Very quiet, flat and worn out after a hard day, close to tears but holding it. Soft, breathy, close to the microphone.' },
  dev: { name: 'Dev', design: 'Man, 36, Indian-American. A startup founder on a call: bright, fast, salesman polish that slips now and then into honest tiredness. Clear and energetic.' },
  hana: { name: 'Hana', design: 'Woman, 45, Japanese-American. A baker at five in the morning, on her way to an oven full of battery cells: sleepy, low and content, smiling as she speaks. Unhurried and warm.' },
  kit: { name: 'Kit', design: 'Man, 23, American. Wound up and funny, talking fast and under his breath because he is balancing a wedding cake on his knees. Light, tense, likeable.' },
  ellis: { name: 'Ellis', design: 'Woman, 52, Irish (Dublin). A novelist who cannot sleep: wry, smoky, thoughtful, amused by herself. Low and unhurried.' },
};

/**
 * Riders. One robot to a ride, and nobody makes conversation: each says a few short things,
 * mostly to themselves, and each of those is its own recording:
 *   hello  as they get in
 *   lines  now and then on the way
 *   bye    as they get out
 * A rider's id is also the id of their voice above. `hours` limits a ride to part of the day:
 * [from, to], wrapping past midnight. `call` means the lines are one side of a call: the rider
 * holds a hand to the side of the head while it lasts, and lowers it when it is over.
 *
 * The robots all look much alike, so `look` is only the `frame` (the build: 'a' broad, 'b' slight),
 * an optional `build` ([width, height]), and anything they carry.
 */
export const RIDERS = [
  {
    id: 'maya', color: '#e0795b', from: 'tower', to: 'cafe', hours: [8, 20], call: true,
    look: { frame: 'b' },
    memory: 'Asked where she sees herself in five years, she said "still under warranty". They laughed. She hears on Friday.',
    hello: '[exhales] Okay. Okay, okay.',
    lines: [
      'Mom. Hi. Yeah, I just got out.',
      "I said 'still under warranty'. And they laughed.",
      'The real laugh. ...Friday. They said Friday.',
    ],
    bye: 'Wish me luck.',
  },
  {
    id: 'okafor', color: '#7a9e7e', from: 'station', to: 'terrace',
    look: { frame: 'a', build: [1.04, 0.99] },
    memory: 'Thirty-one years at the wheel of a cab in this city, until the cabs lost their wheels. "All right," he said. "You\'ll do."',
    hello: '[chuckles] Well. Nobody home.',
    lines: [
      'Thirty-one years I drove a cab in this city.',
      'Loud, it was. Everybody talking.',
      "...Fir IS faster. [laughs] All right. You'll do.",
    ],
    bye: 'Keep your sensors clean out there.',
  },
  {
    id: 'priya', color: '#b06fd6', from: 'foundry', to: 'cobalt', hours: [19, 3.5],
    look: { frame: 'b', build: [0.97, 0.96] },
    memory: 'Came out of the show with her audio still clipping. The second song was worth it.',
    hello: "Empty. I told him it'd be empty.",
    lines: [
      "My audio's still clipping.",
      "That's how you know it was loud.",
      '[softly] ...That second song, though.',
    ],
    bye: 'Thanks, Nim.',
  },
  {
    id: 'theo', color: '#8f7fd0', from: 'foundry', to: 'diner', hours: [19, 3.5],
    look: { frame: 'a' },
    memory: 'A full charge after the show, because time is not real in a diner.',
    hello: "Huh. It's actually empty.",
    lines: [
      "...I didn't hate that.",
      'A full charge. And the warm oil.',
      "It's a diner. Time isn't real there.",
    ],
    bye: 'Thanks, car. ...Nim. Thanks, Nim.',
  },
  {
    id: 'lena', color: '#6aa6c9', from: 'hospital', to: 'cobalt', call: true,
    look: { frame: 'b' },
    memory: 'Mr. Abara walked out of the clinic on his own two legs. Best thing she saw all month.',
    hello: '[sighs] Home. Slowly is fine.',
    lines: [
      "Jo. It's me. Long one today.",
      'Mr. Abara walked out. On his own two legs.',
      "[laughs softly] ...It's so quiet I can hear my own fans.",
    ],
    bye: 'Quietest part of my day.',
  },
  {
    id: 'gus', color: '#e2b23c', from: 'studio', to: 'theater', hours: [15, 23.5],
    look: { frame: 'a', build: [1.03, 1.0] },
    memory: 'Tried the new bit on an empty cab. Tough room. He is keeping it.',
    hello: 'A captive audience. Perfect.',
    lines: [
      'Okay. Okay. New bit.',
      "No driver. And I STILL don't know how much to tip.",
      '...Nothing? Tough room.',
    ],
    bye: 'Wish me luck. Or whatever it is cars do.',
  },
  {
    id: 'june', color: '#d98aa4', from: 'market', to: 'lofts', hours: [9, 20], call: true,
    look: { frame: 'b', build: [1, 0.94] },
    memory: 'Warm oil for a grandson running hot, and a smoother ride than his grandfather ever gave her.',
    hello: 'Oh. It drives itself. Mind the flask.',
    lines: [
      "Daniel. Don't 'I'm fine' me, I can hear your fan.",
      "I'm bringing oil. The good one. Warm.",
      'Smoother than your grandfather ever drove. [laughs]',
    ],
    bye: 'Thank you, dear. Beautifully driven.',
  },
  {
    id: 'sam', color: '#58b89a', from: 'library', to: 'hall', hours: [7, 22],
    look: { frame: 'b', build: [0.95, 0.95] },
    memory: 'Intercalation. Got it right, and was still sure of failing.',
    hello: "Late. I'm late, I'm so late.",
    lines: [
      'The cell is the powerhouse of the robot.',
      'Lithium goes in. Inter... [groans] ...calation.',
      "...I'm going to fail.",
    ],
    bye: "Okay. Okay. I've got this.",
  },
  {
    id: 'rafael', color: '#c7714a', from: 'records', to: 'park', hours: [10, 21.5],
    look: { frame: 'a' },
    memory: 'He had a whole speech and forgot it on purpose. He kept the last line.',
    hello: 'Linden Park. [exhales] Okay.',
    lines: [
      "'Dani. I had a whole speech.'",
      "[whispers] Ring. Ring... compartment. It's in the compartment.",
      "'Just the last line.' [exhales] Yeah. That's the one.",
    ],
    bye: 'Okay. Here goes.',
  },
  {
    id: 'bea', color: '#5c8fd6', from: 'pier', to: 'hotel', hours: [8, 22],
    look: { frame: 'b', build: [1.04, 0.95] },
    memory: 'On holiday and reviewing everything: the street names, the smell of warm oil, the cab.',
    hello: 'No driver! Tom would hate this.',
    lines: [
      "Ooh, 'Ginkgo Street'. How do you even say that?",
      'It all smells of warm oil. Lovely.',
      "I'm going to write a review.",
    ],
    bye: 'Lovely. Just lovely.',
  },
  {
    id: 'tom', color: '#7d8fb0', from: 'market', to: 'hotel', hours: [8, 22],
    look: { frame: 'a', build: [1.06, 1.0] },
    memory: 'Sent across town for the good oil. Liked the ride more than he will admit to Bea.',
    hello: 'After you. ...Ah. Nobody.',
    lines: [
      'The good oil, she said. Other side of town.',
      "She'll have reviewed the hotel by now.",
      "...Very smooth, this. I'll not tell her.",
    ],
    bye: 'Ta. Very smooth.',
  },
  {
    id: 'noor', color: '#8a8fa8', from: 'cobalt', to: 'pier',
    look: { frame: 'b' },
    memory: 'Five quiet minutes, all hers.',
    hello: '[quietly] Pier Seven.',
    lines: [
      '[exhales] ...What a day.',
      'Everything I touched threw an error.',
      '[exhales] ...Okay. ...Okay.',
    ],
    bye: "That helped. I don't know why.",
  },
  {
    id: 'dev', color: '#4fb0c6', from: 'hotel', to: 'station', hours: [6, 19], call: true,
    look: { frame: 'a' },
    memory: 'Four months of charge left in the company, and a product robots actually like.',
    hello: "Station. Hello, hello. Let's go.",
    lines: [
      "Hey! Yes! Can you hear me? I'm in a robotaxi.",
      'The numbers are... a journey. Up. If you squint.',
      'Four months. And a product robots actually like.',
    ],
    bye: 'Not one hard question. Thank you.',
  },
  {
    id: 'hana', color: '#e39a4a', from: 'terrace', to: 'bakery', hours: [4.5, 8.5],
    look: { frame: 'b', build: [0.98, 0.94] },
    memory: 'Cells that formed all night. "The first warm thing of the day."',
    hello: '[yawns] Morning.',
    lines: [
      'Nobody awake but us.',
      'The cells have been forming all night.',
      'The first warm thing of the day.',
    ],
    bye: 'Come by at seven.',
  },
  {
    id: 'kit', color: '#f08a7c', from: 'bakery', to: 'hotel', hours: [9, 19],
    look: { frame: 'a', cake: true },
    memory: 'Three tiers of buttercream across town, for a wedding where nobody can eat it. Not a crumb out of place.',
    hello: "Nobody panic. I'm holding a cake.",
    lines: [
      'Three tiers. And nobody there can even eat it.',
      '[whispers] Oh no. Oh no, a turn...',
      '[exhales] ...Oh. That was nothing.',
    ],
    bye: 'Not a crumb out of place.',
  },
  {
    id: 'ellis', color: '#9bb0c9', from: 'lofts', to: 'diner', hours: [21, 4.5],
    look: { frame: 'b', build: [0.98, 0.98] },
    memory: '"The city was mostly a weather report." Three days stuck on that sentence, and then she was not.',
    hello: "Don't tell anyone I'm off the charger.",
    lines: [
      "'The city was...' The city was WHAT.",
      "Wet? That's not literature. That's a weather report.",
      "...'Mostly a weather report.' Huh. Hang on.",
    ],
    bye: "You're in the acknowledgments. Small print.",
  },
];

/** A rider's recordings in the order they are heard: [[clip, text], ...]. The clip names the file. */
export function clipsOf(rider) {
  return [['hello', rider.hello], ...rider.lines.map((text, i) => [String(i + 1), text]), ['bye', rider.bye]];
}

/** Things the car says on its own. `when` tells the ride script what each is for. */
export const CAR_LINES = [
  { id: 'welcome_1', when: 'welcome', text: 'Welcome aboard. Make yourself comfortable.' },
  { id: 'welcome_2', when: 'welcome', text: "Hi there. I'll take it from here." },
  { id: 'welcome_night', when: 'welcome_night', text: 'Good evening. Welcome aboard.' },
  { id: 'welcome_morning', when: 'welcome_morning', text: 'Good morning. Welcome aboard.' },
  { id: 'depart_1', when: 'depart', text: 'Okay. Here we go.' },
  { id: 'depart_2', when: 'depart', text: "Seatbelts on? Then we're off." },
  { id: 'near_1', when: 'near', text: "We're about two minutes away." },
  { id: 'near_2', when: 'near', text: 'Almost there.' },
  { id: 'arrive_1', when: 'arrive', text: "You've arrived. Take your time, and check you have everything." },
  { id: 'arrive_2', when: 'arrive', text: 'Here we are. Mind the curb on your way out.' },
  { id: 'bye_1', when: 'bye', text: 'Thanks for riding. Take care.' },
  { id: 'bye_2', when: 'bye', text: 'Goodbye. Have a good one.' },
  { id: 'rain', when: 'rain', text: "It's raining, so I'm leaving a little more room than usual." },
  { id: 'storm', when: 'storm', text: "There's a storm overhead. I'll take it slowly." },
  { id: 'fog', when: 'fog', text: "It's foggy out. I can see fine, but I'll keep the speed down." },
  { id: 'snow', when: 'snow', text: "The road is slippery. We'll go gently." },
  { id: 'crossing', when: 'crossing', text: 'Just waiting for someone to cross.' },
  { id: 'light', when: 'light', text: 'Red light. Back in a moment.' },
];

/** Subtitle text: the line with its delivery cues removed. */
export function plain(text) {
  return text.replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();
}

/** Characters a line takes to say, for spreading subtitles across a recording. */
export function weight(text) {
  const cues = (text.match(/\[[^\]]*\]/g) || []).length;
  const dots = (text.match(/\.\.\./g) || []).length;
  return plain(text).length + cues * 12 + dots * 9 + 10;
}
