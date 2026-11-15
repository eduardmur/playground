// Every recorded sound in the game, with the prompt it was generated from (ElevenLabs sound effects
// v2 and music v2.5, through the ElevenLabs connector). scripts/audio-tools.mjs turns the raw takes
// in takes/ into public/audio/; the game plays a recording where there is one and its own synthesised
// stand-in (audio/audio.js) everywhere else, so the game still sounds complete without the files.
//
//   seconds   the length asked for
//   loop      a bed that runs continuously (generated with loop on)
//   variants  how many takes the game keeps and picks from at random, for sounds heard again and again
//   tonal     one recorded note: the build measures its pitch and the game plays tunes with it

export const SFX = [
  // the dogs
  { id: 'bark', seconds: 1, variants: 3, prompt: 'One single short bark from a friendly medium-sized dog, outdoors in a park, close up, dry and clear' },
  { id: 'yip', seconds: 0.6, variants: 3, prompt: 'One single short happy yip from a small playful dog, outdoors, close up' },
  { id: 'howl', seconds: 4, prompt: 'A lone dog howling softly at the moon, one long rising and falling howl, outdoors at night' },
  { id: 'crunch', seconds: 1.5, variants: 2, prompt: 'A dog chewing and crunching a small dry dog biscuit, close up' },
  { id: 'lap', seconds: 0.7, variants: 3, prompt: 'A dog lapping water from a pond with its tongue, two quick wet laps, close up' },
  { id: 'splash', seconds: 1.5, variants: 2, prompt: 'A dog jumping into a pond, one big water splash' },
  { id: 'paddle', seconds: 0.7, variants: 3, prompt: 'A dog paddling in a pond, one soft swimming stroke through water' },
  { id: 'step', seconds: 0.5, variants: 3, prompt: "One soft footstep of a dog's paw on grass, close up" },
  { id: 'step_hard', seconds: 0.5, variants: 3, prompt: "One light footstep of a dog's paw on a stone path, a soft click of claws" },
  { id: 'pickup', seconds: 0.5, prompt: 'A dog picking up a tennis ball in its mouth, a soft squeeze' },
  { id: 'toss', seconds: 0.6, prompt: 'A quick soft whoosh of a ball thrown through the air' },
  { id: 'land', seconds: 0.5, variants: 2, prompt: 'A dog landing on soft grass after a jump, a soft thump' },
  { id: 'boing', seconds: 0.5, variants: 2, prompt: 'A tennis ball bouncing once on grass' },
  { id: 'shake', seconds: 1.5, prompt: 'A wet dog shaking water off its fur, a burst of water droplets and flapping ears' },
  { id: 'sniff', seconds: 1.5, prompt: 'A dog sniffing the ground, quick curious sniffs, close up' },
  { id: 'yawn', seconds: 1.6, prompt: 'A dog giving a big sleepy yawn with a little squeak at the end' },
  { id: 'dig', seconds: 2, prompt: 'A dog digging quickly in soft earth with its front paws, dirt scattering' },
  // the park
  { id: 'flutter', seconds: 2, prompt: 'A flock of pigeons suddenly taking off from the ground, wings flapping' },
  { id: 'owl', seconds: 3, prompt: 'A tawny owl hooting in the distance at night, outdoors' },
  { id: 'frog', seconds: 1.2, prompt: 'A single frog croaking near a pond at night' },
  { id: 'whoosh', seconds: 2.8, prompt: 'A long soft airy whoosh of a breeze sweeping past' },
  // the little tunes for a joy, a friend, a game of tag: one note, played at several pitches
  { id: 'bell', seconds: 2, tonal: true, prompt: 'A single soft kalimba note, clean and gentle, ringing out' },
  // beds
  { id: 'birds', seconds: 20, loop: true, prompt: 'Gentle birdsong in a quiet park in the morning, a few songbirds, calm and spacious' },
  { id: 'crickets', seconds: 20, loop: true, prompt: 'Crickets chirping softly in a meadow on a warm summer night' },
  { id: 'wind', seconds: 20, loop: true, prompt: 'Soft wind through grass and leaves in an open park' },
  { id: 'pond', seconds: 15, loop: true, prompt: 'Small gentle ripples of pond water lapping at a grassy shore' },
  { id: 'fountain', seconds: 15, loop: true, prompt: 'A small stone fountain splashing water steadily into its basin' },
];

/** The score: one track for each part of the day, chosen by the light. */
export const MUSIC = [
  { id: 'morning', prompt: 'Gentle instrumental for a peaceful morning in a sunny park: warm fingerpicked acoustic guitar, soft felt piano, a light shaker. Slow, calm and airy, around 70 BPM. No vocals, no drum kit.' },
  { id: 'afternoon', prompt: 'A lazy sunny afternoon at the park, cosy and a little playful: kalimba, soft felt piano, warm upright bass, very light brushed percussion. Slow, around 75 BPM, content and calm. No vocals.' },
  { id: 'dusk', prompt: 'Golden hour at sunset, warm and a little wistful: slow felt piano, soft string pads, a gentle glockenspiel now and then. Very calm, around 60 BPM. No vocals, no drums.' },
  { id: 'night', prompt: 'A quiet night under the stars: sparse soft piano notes with long reverb over warm ambient pads, very slow and sleepy, around 55 BPM. Peaceful. No vocals, no drums.' },
];

/** The files a sound is played from: 'sfx/bark_1', 'sfx/bark_2', ... or just 'sfx/howl'. */
export const sfxFiles = (s) => (s.variants ? Array.from({ length: s.variants }, (_, i) => `sfx/${s.id}_${i + 1}`) : [`sfx/${s.id}`]);
