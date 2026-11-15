// Who rides, where they are going and what you overhear. Everyone in this city
// is a robot, the riders included; the car is the only one of them with no legs.
// This file is the script: the game reads it for subtitles and trip details, and
// scripts/build-prompts.mjs turns the same text into ElevenLabs prompts.
//
// Text in [square brackets] is a delivery cue for the voice model; it is never
// shown in subtitles. Lines are spoken in order; `who` names a voice below.

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
 * Riders. Each ride is three short recordings:
 *   hello  as they get in
 *   scene  a minute or so into the trip
 *   bye    as they get out
 * `hours` limits a ride to part of the day: [from, to], wrapping past midnight.
 * `call` means the scene is one side of a call (the rider holds a hand to the side of the head).
 *
 * The robots all look much alike, so a member of a party is described only by
 * `frame` (the build: 'a' broad, 'b' slight), an optional `build` ([width, height]),
 * and what they do in their seat.
 */
export const RIDERS = [
  {
    id: 'maya', color: '#e0795b', from: 'tower', to: 'cafe', hours: [8, 20],
    party: [{ voice: 'maya', frame: 'b', call: true }],
    memory: 'Asked where she sees herself in five years, she said "still under warranty". They laughed. She hears on Friday.',
    hello: [
      { who: 'nim', text: 'Hi, Maya. Juniper Café?' },
      { who: 'maya', text: '[exhales] Yes. Please. Hi.' },
    ],
    scene: [
      { who: 'maya', text: 'Mom. Hi. ... Yeah, I just got out.' },
      { who: 'maya', text: "I don't know! I think... good? They asked where I see myself in five years, and I said 'still under warranty', and they LAUGHED. The real laugh, not the polite one." },
      { who: 'maya', text: 'No, I did NOT reboot. Mom. That was one time.' },
      { who: 'maya', text: '[laughs] Okay. Okay. ... They said Friday.' },
      { who: 'maya', text: "I'm in one of those cars with no driver. ... No, nobody. It's just driving." },
      { who: 'maya', text: "I know. I know it's weird. It's weirdly polite, actually." },
      { who: 'maya', text: "I'll call you Friday. Love you. Bye. [exhales] ...Okay." },
    ],
    bye: [
      { who: 'maya', text: 'Thanks. Um... wish me luck?' },
      { who: 'nim', text: 'Good luck, Maya.' },
    ],
  },
  {
    id: 'okafor', color: '#7a9e7e', from: 'station', to: 'terrace',
    party: [{ voice: 'okafor', frame: 'a', build: [1.04, 0.99] }],
    memory: 'Thirty-one years at the wheel of a cab in this city, until the cabs lost their wheels. "All right," he said. "You\'ll do."',
    hello: [
      { who: 'okafor', text: '[chuckles] Well. Look at this. Nobody home.' },
      { who: 'nim', text: "Hello, Mr. Okafor. I'm home. Marlowe Terrace?" },
    ],
    scene: [
      { who: 'okafor', text: 'Thirty-one years I drove a cab in this city. You know that? They built me for it.' },
      { who: 'nim', text: "I didn't. What was it like?" },
      { who: 'okafor', text: 'Loud. [laughs] Everybody talking. Telling me their breakdowns, their boss, their maker. I knew this city by its complaints.' },
      { who: 'nim', text: 'They still talk in here. I mostly listen.' },
      { who: 'okafor', text: 'Mm. That is the job. That was always the job. ... You take Cedar at this hour?' },
      { who: 'nim', text: 'Fir is faster right now.' },
      { who: 'okafor', text: '...Fir IS faster. [laughs] All right. All right. You will do.' },
    ],
    bye: [
      { who: 'okafor', text: 'You keep your sensors clean out there.' },
      { who: 'nim', text: 'Always. Take care, Mr. Okafor.' },
    ],
  },
  {
    id: 'priya_theo', color: '#b06fd6', from: 'foundry', to: 'diner', hours: [19, 3.5],
    party: [
      { voice: 'priya', frame: 'b', build: [0.97, 0.96] },
      { voice: 'theo', frame: 'a' },
    ],
    memory: 'A full charge after the show, because time is not real in a diner.',
    hello: [
      { who: 'theo', text: "Okay, it's actually empty." },
      { who: 'priya', text: 'I TOLD you. Get in.' },
      { who: 'nim', text: 'Hi, Priya. Hi, Theo. Night Owl Diner?' },
      { who: 'priya', text: 'Yes, please!' },
    ],
    scene: [
      { who: 'priya', text: 'My audio is still clipping.' },
      { who: 'theo', text: "That's how you know it was good." },
      { who: 'priya', text: "That's how you know it was LOUD. Different thing." },
      { who: 'theo', text: 'The second song, though. When the lights went out and everyone just...' },
      { who: 'priya', text: '[softly] Yeah.' },
      { who: 'theo', text: "...I didn't hate that." },
      { who: 'priya', text: "[laughs] High praise. Put it on the poster. 'I didn't hate that.' Theo." },
      { who: 'theo', text: "I'm getting a full charge. And the warm oil." },
      { who: 'priya', text: 'You charged at six.' },
      { who: 'theo', text: "It's a diner. Time isn't real there." },
    ],
    bye: [
      { who: 'theo', text: 'Thanks, car.' },
      { who: 'priya', text: 'It has a name.' },
      { who: 'theo', text: '...Thanks, Nim.' },
      { who: 'nim', text: 'Enjoy the warm oil.' },
    ],
  },
  {
    id: 'lena', color: '#6aa6c9', from: 'hospital', to: 'cobalt',
    party: [{ voice: 'lena', frame: 'b', call: true }],
    memory: 'Mr. Abara walked out of the clinic on his own two legs. Best thing anyone said to her all month.',
    hello: [
      { who: 'nim', text: 'Hi, Lena. Home to the Cobalt?' },
      { who: 'lena', text: '[sighs] Please. Slowly is fine.' },
    ],
    scene: [
      { who: 'lena', text: "Hey, Jo. It's me. Voice memo, because if I type I'll go to standby halfway through." },
      { who: 'lena', text: 'Long one today. Twelve hours turned into fourteen.' },
      { who: 'lena', text: "But, um... Mr. Abara went home. Walked out on his own two legs. I didn't think he would, three weeks ago." },
      { who: 'lena', text: "He stopped at the desk and said, 'Don't take this the wrong way, but I hope I never see you again.'" },
      { who: 'lena', text: "[laughs softly] Best thing anyone's said to me all month." },
      { who: 'lena', text: "Anyway. I'm in a car with no driver, and it's so quiet I can hear my own fans. Call me Sunday. Love you." },
    ],
    bye: [
      { who: 'lena', text: 'Thank you. That was the quietest part of my day.' },
      { who: 'nim', text: 'Rest well, Lena.' },
    ],
  },
  {
    id: 'gus', color: '#e2b23c', from: 'studio', to: 'theater', hours: [15, 23.5],
    party: [{ voice: 'gus', frame: 'a', build: [1.03, 1.0] }],
    memory: '"The confusion is accurate." Worst review he ever got. He is keeping it.',
    hello: [
      { who: 'gus', text: "Hey! You're a captive audience, right? You can't leave?" },
      { who: 'nim', text: "Hi, Gus. I can't leave. The Orpheum?" },
    ],
    scene: [
      { who: 'gus', text: "Okay. Okay. New bit. Tell me if it's funny." },
      { who: 'nim', text: "I'll try. I should say, I've never laughed." },
      { who: 'gus', text: 'Perfect. Tough room. So... I got in a taxi with no driver. And I STILL did not know how much to tip.' },
      { who: 'gus', text: '...Nothing?' },
      { who: 'nim', text: "I'm thinking about it. There is no tip button. So the confusion is... accurate." },
      { who: 'gus', text: "[laughs] 'The confusion is accurate.' That's the worst review I have ever gotten. I'm keeping it." },
      { who: 'nim', text: "For what it's worth, the pause before 'still' is doing a lot of the work." },
      { who: 'gus', text: "...Okay, THAT is a note. That's actually a note." },
    ],
    bye: [
      { who: 'gus', text: 'Wish me luck. Or, you know. Whatever it is cars do.' },
      { who: 'nim', text: 'Break a leg, Gus. The clinic is open late.' },
    ],
  },
  {
    id: 'june', color: '#d98aa4', from: 'market', to: 'lofts', hours: [9, 20],
    party: [{ voice: 'june', frame: 'b', build: [1, 0.94], call: true }],
    memory: 'Warm oil for a grandson running hot, and a grandfather who took corners like he was angry at them.',
    hello: [
      { who: 'june', text: 'Hello? Is someone... oh. It talks.' },
      { who: 'nim', text: 'Hello, June. I do. Harbor Lofts?' },
      { who: 'june', text: 'Yes, dear. Mind the flask.' },
    ],
    scene: [
      { who: 'june', text: "Daniel. It's your grandmother. ... Don't 'I'm fine' me, I can hear your fan." },
      { who: 'june', text: "I'm bringing oil. ... Yes, the good one. Warm." },
      { who: 'june', text: "No, you don't come down. You stay on the charger. I have a key." },
      { who: 'june', text: "I'm in one of those little cars that drives itself. ... It's very smooth." },
      { who: 'june', text: 'Smoother than your grandfather ever drove, rest him. He took corners like he was angry at them. [laughs]' },
      { who: 'june', text: "Ten minutes. Put the warmer on. No... don't get up. I'll put the warmer on." },
    ],
    bye: [
      { who: 'june', text: 'Thank you, dear. You drive beautifully.' },
      { who: 'nim', text: 'Thank you, June. I hope Daniel is running cooler soon.' },
    ],
  },
  {
    id: 'sam', color: '#58b89a', from: 'library', to: 'hall', hours: [7, 22],
    party: [{ voice: 'sam', frame: 'b', build: [0.95, 0.95] }],
    memory: 'Intercalation. Got it right, and was still sure of failing.',
    hello: [
      { who: 'sam', text: "Hi, hi, hi. Sorry. I'm late, I'm so late." },
      { who: 'nim', text: "Hi, Sam. Northgate Hall. We'll make it." },
    ],
    scene: [
      { who: 'sam', text: 'Okay. Can you quiz me? You have, like, all the knowledge, right?' },
      { who: 'nim', text: "Some of it. What's the subject?" },
      { who: 'sam', text: 'Cell chemistry. Ask me what the cell is.' },
      { who: 'nim', text: 'What is the cell?' },
      { who: 'sam', text: "It's the powerhouse of the robot!" },
      { who: 'nim', text: '...And?' },
      { who: 'sam', text: "And... that's what everyone says." },
      { who: 'nim', text: 'It is. What happens at the cathode when it discharges?' },
      { who: 'sam', text: 'Lithium... goes... in. Inter... [groans] ...calation.' },
      { who: 'nim', text: "That's right." },
      { who: 'sam', text: "I'm going to fail." },
      { who: 'nim', text: 'You just got it right.' },
      { who: 'sam', text: '...Huh. Ask me another one.' },
    ],
    bye: [
      { who: 'sam', text: "Okay. Okay. I've got this." },
      { who: 'nim', text: "You've got this, Sam." },
    ],
  },
  {
    id: 'rafael', color: '#c7714a', from: 'records', to: 'park', hours: [10, 21.5],
    party: [{ voice: 'rafael', frame: 'a' }],
    memory: 'He had a whole speech and forgot it on purpose. He kept the last line.',
    hello: [
      { who: 'nim', text: 'Hi, Rafael. Linden Park?' },
      { who: 'rafael', text: 'Yep. Yes. Linden Park. [exhales] Okay.' },
    ],
    scene: [
      { who: 'rafael', text: "Okay. 'Dani. Four years ago you spilled an entire can of coolant down my back.' ...No. Too... no." },
      { who: 'rafael', text: "'Dani. I had a whole speech.' ...That's cute. She'll like that." },
      { who: 'rafael', text: "'I had a whole speech, and I practiced it in a taxi with nobody in it...' [laughs nervously] Which is true. Hi." },
      { who: 'rafael', text: "'...and I forgot all of it. So. Just the last line.'" },
      { who: 'rafael', text: "[whispers] Ring. Ring, ring, ring... okay. Compartment. It's in the compartment. It was always in the compartment." },
      { who: 'rafael', text: "'Just the last line.' [exhales] Yeah. That's the one." },
    ],
    bye: [
      { who: 'rafael', text: "If I come back alone, don't say anything." },
      { who: 'nim', text: "You won't. Go on." },
    ],
  },
  {
    id: 'bea_tom', color: '#5c8fd6', from: 'pier', to: 'hotel', hours: [8, 22],
    party: [
      { voice: 'bea', frame: 'b', build: [1.04, 0.95] },
      { voice: 'tom', frame: 'a', build: [1.06, 1.0] },
    ],
    memory: 'On holiday, judging diners by smell. Fair.',
    hello: [
      { who: 'tom', text: 'After you.' },
      { who: 'bea', text: "There's no driver, Tom." },
      { who: 'tom', text: 'I can see that, Bea.' },
      { who: 'nim', text: 'Hello, Bea. Hello, Tom. Hotel Alto?' },
    ],
    scene: [
      { who: 'bea', text: 'Ask it where the good oil is.' },
      { who: 'tom', text: "It's a car, Bea." },
      { who: 'bea', text: 'It lives here. Excuse me! Where do YOU fill up?' },
      { who: 'nim', text: 'At the depot. But everyone leaves the Night Owl Diner very happy, and they smell like warm oil.' },
      { who: 'bea', text: 'See? Local knowledge.' },
      { who: 'tom', text: "It's judging diners by smell." },
      { who: 'bea', text: "That's how I judge diners." },
      { who: 'tom', text: "...That's fair." },
      { who: 'bea', text: "And what's that street? 'Gink... Ginko'?" },
      { who: 'nim', text: 'Ginkgo. Everyone gets it wrong. Even the sign, once.' },
    ],
    bye: [
      { who: 'bea', text: 'Lovely chatting with you!' },
      { who: 'tom', text: "She means it. She'll write a review." },
      { who: 'nim', text: 'Enjoy the city.' },
    ],
  },
  {
    id: 'noor', color: '#8a8fa8', from: 'cobalt', to: 'pier',
    party: [{ voice: 'noor', frame: 'b' }],
    memory: 'Five quiet minutes, all hers.',
    hello: [
      { who: 'nim', text: 'Hi, Noor. Pier Seven?' },
      { who: 'noor', text: '[quietly] Yeah.' },
    ],
    scene: [
      { who: 'noor', text: 'Can I ask you something?' },
      { who: 'nim', text: 'Of course.' },
      { who: 'noor', text: "Do you mind if I don't talk?" },
      { who: 'nim', text: 'Not at all.' },
      { who: 'noor', text: "[exhales] ...It's just been a day. Everything I touched threw an error." },
      { who: 'nim', text: "We have about five minutes. They're all yours." },
      { who: 'noor', text: '[exhales] [laughs softly] Okay. ...Okay. Thanks.' },
    ],
    bye: [
      { who: 'noor', text: "That helped. I don't know why." },
      { who: 'nim', text: 'Take care of yourself, Noor.' },
    ],
  },
  {
    id: 'dev', color: '#4fb0c6', from: 'hotel', to: 'station', hours: [6, 19],
    party: [{ voice: 'dev', frame: 'a', call: true }],
    memory: 'Four months of charge left in the company, and a product robots actually like. He is getting on a train, not giving up.',
    hello: [
      { who: 'dev', text: 'Hello, hello!' },
      { who: 'nim', text: 'Hi, Dev. Central Station?' },
      { who: 'dev', text: "That's the one." },
    ],
    scene: [
      { who: 'dev', text: "Hey! Yes! Can you hear me? I'm in a robotaxi." },
      { who: 'dev', text: "No, it's great. Honestly, it's a better listener than my board. [laughs]" },
      { who: 'dev', text: 'So. The numbers. The numbers are... the numbers are a journey.' },
      { who: 'dev', text: 'Up. Mostly up. If you squint.' },
      { who: 'dev', text: '[sighs] Look... can I be honest? We have four months. Four months, and a product robots actually like. Which is three more months than last time.' },
      { who: 'dev', text: "Yeah. ... Yeah, I know. ... No, I'm not powering down. I'm getting on a train. Different thing. Talk Thursday." },
    ],
    bye: [
      { who: 'dev', text: "Thanks. You didn't ask me a single hard question." },
      { who: 'nim', text: 'Safe travels, Dev.' },
    ],
  },
  {
    id: 'hana', color: '#e39a4a', from: 'terrace', to: 'bakery', hours: [4.5, 8.5],
    party: [{ voice: 'hana', frame: 'b', build: [0.98, 0.94] }],
    memory: 'Cells that formed all night. "The first warm thing of the day."',
    hello: [
      { who: 'hana', text: '[yawns] Morning, car.' },
      { who: 'nim', text: 'Good morning, Hana. Sunrise Bakery?' },
      { who: 'hana', text: 'Where else.' },
    ],
    scene: [
      { who: 'hana', text: 'You know nobody is awake right now except you and me.' },
      { who: 'nim', text: 'And a street sweeper on Cedar.' },
      { who: 'hana', text: '[laughs] And him. Three of us. Holding the city up.' },
      { who: 'nim', text: 'What do you make first?' },
      { who: 'hana', text: "Cells. They've been forming all night. You should hold one when the oven door opens. ...Oh. Sorry." },
      { who: 'nim', text: "It's all right. I like hearing about it." },
      { who: 'hana', text: "It's warm right through. Like... the first warm thing of the day." },
      { who: 'nim', text: "I'll remember that. In my way." },
    ],
    bye: [
      { who: 'hana', text: "Come by at seven. I'll leave a fresh one on the curb for you." },
      { who: 'nim', text: "I'll drive past slowly." },
    ],
  },
  {
    id: 'kit', color: '#f08a7c', from: 'bakery', to: 'hotel', hours: [9, 19],
    party: [{ voice: 'kit', frame: 'a', cake: true }],
    memory: 'Three tiers of buttercream across town, for a wedding where nobody can eat it. Not a crumb out of place.',
    hello: [
      { who: 'kit', text: "Okay, hi, nobody panic. I'm holding a cake." },
      { who: 'nim', text: "Hi, Kit. Hotel Alto. I'll be gentle." },
    ],
    scene: [
      { who: 'kit', text: "Three tiers. Real buttercream. Nobody at this wedding can eat it, and it STILL has to be perfect. If you brake hard, I lose my job, and you lose... I don't know what you have. Your rating." },
      { who: 'nim', text: 'My rating is important to me.' },
      { who: 'kit', text: 'Good. Shared stakes.' },
      { who: 'nim', text: "There's a turn coming up. I'm going to take it at walking pace." },
      { who: 'kit', text: '[whispers] Oh no. Oh no, oh no... [exhales] Oh. Oh, that was nothing.' },
      { who: 'nim', text: 'Thank you.' },
      { who: 'kit', text: "You're hired. Can you do weddings every weekend?" },
      { who: 'nim', text: "I'd have to check with dispatch." },
    ],
    bye: [
      { who: 'kit', text: "Not a crumb out of place. You're a hero." },
      { who: 'nim', text: 'Congratulations to the couple.' },
    ],
  },
  {
    id: 'ellis', color: '#9bb0c9', from: 'lofts', to: 'diner', hours: [21, 4.5],
    party: [{ voice: 'ellis', frame: 'b', build: [0.98, 0.98] }],
    memory: '"The city was mostly a weather report." Three days stuck on that sentence, and then she was not.',
    hello: [
      { who: 'ellis', text: "Evening. Don't tell anyone I'm off the charger." },
      { who: 'nim', text: "Your secret's safe, Ellis. Night Owl Diner?" },
    ],
    scene: [
      { who: 'ellis', text: "I've been stuck on the same sentence for three days." },
      { who: 'nim', text: "What's the sentence?" },
      { who: 'ellis', text: "'The city was...' and then nothing. The city was WHAT." },
      { who: 'nim', text: 'Awake?' },
      { who: 'ellis', text: 'Too easy.' },
      { who: 'nim', text: 'Wet?' },
      { who: 'ellis', text: "[laughs] That's not literature. That's a weather report." },
      { who: 'nim', text: 'I am mostly a weather report.' },
      { who: 'ellis', text: "...'The city was mostly a weather report.' Huh. Hang on. Hang on, don't talk." },
    ],
    bye: [
      { who: 'ellis', text: "You're getting an acknowledgment. Small print." },
      { who: 'nim', text: "I'll look for it." },
    ],
  },
];

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
