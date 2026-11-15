// Every sound the game can play, with the prompt that makes it.
//
// The game looks for a recording at public/audio/<file>.(mp3|wav|m4a|ogg) and
// falls back to a synthesised stand-in when there is none, so it can be played
// before any of these exist. scripts/build-prompts.mjs prints this list, and
// the scripts in data/riders.js, as ELEVENLABS.md.

/**
 * Sound effects. `loop` ones are generated with ElevenLabs' loop option on.
 * `seconds` is the length to ask for; `influence` is the prompt-influence slider (0..1).
 */
export const SFX = [
  // ---- beds: things that run for as long as a condition holds
  {
    id: 'cabin_drive', loop: true, seconds: 30, influence: 0.5, gain: 0.5,
    use: 'Always on while moving; volume and pitch follow speed.',
    prompt: 'Interior of a modern electric car driving at a steady 30 miles per hour on smooth city asphalt, recorded from the passenger seat. Low even road rumble, soft tyre hum, a faint high electric motor whine. Constant and unchanging. Seamless loop.',
  },
  {
    id: 'cabin_idle', loop: true, seconds: 20, influence: 0.5, gain: 0.35,
    use: 'Always on, quietly; this is the sound of the cabin itself.',
    prompt: 'Interior of a parked electric car with the climate control running: a soft steady air-conditioning fan blowing through the vents, a gentle airy hiss with a low electrical hum underneath. Constant and unchanging. Seamless loop.',
  },
  {
    id: 'rain_light', loop: true, seconds: 30, influence: 0.5, gain: 0.55,
    use: 'Light to moderate rain.',
    prompt: 'Light rain falling on the roof and windscreen of a car, heard from inside the closed cabin. Soft steady patter with the occasional heavier single drop, close and slightly muffled. Seamless loop.',
  },
  {
    id: 'rain_heavy', loop: true, seconds: 30, influence: 0.5, gain: 0.7,
    use: 'Heavy rain and storms; crossfades with rain_light.',
    prompt: 'Heavy rain drumming hard on a car roof and glass, heard from inside the closed cabin. Dense loud patter, water sheeting down the windows, deep and enveloping. Seamless loop.',
  },
  {
    id: 'wet_road', loop: true, seconds: 20, influence: 0.5, gain: 0.45,
    use: 'Wet road while moving; volume follows speed.',
    prompt: 'Car tyres hissing along a wet road at city speed, heard from inside the car. Continuous watery spray and hiss from under the wheel arches, steady speed. Seamless loop.',
  },
  {
    id: 'wind', loop: true, seconds: 25, influence: 0.45, gain: 0.4,
    use: 'Storms, and a little in snow.',
    prompt: 'Storm wind blowing around a car, heard from inside the cabin: airy gusts rushing past the windows and whistling softly around the door seals, swelling and easing slowly and smoothly. Seamless loop.',
  },
  {
    id: 'city_day', loop: true, seconds: 30, influence: 0.45, gain: 0.3,
    use: 'The city outside by day; opens up when a door is open.',
    prompt: 'A downtown city street by day, heard through closed car windows. A muffled wash of distant traffic, a far-off horn now and then, faint footsteps and indistinct voices on the pavement, a bus pulling away in the distance. Soft and low. Seamless loop.',
  },
  {
    id: 'city_night', loop: true, seconds: 30, influence: 0.45, gain: 0.26,
    use: 'The city outside at night.',
    prompt: 'A quiet city street late at night, heard through closed car windows. Low distant traffic hum, a faraway train, the faint electrical buzz of street lights, long calm gaps, a single distant car now and then. Muffled and sparse. Seamless loop.',
  },
  {
    id: 'birds_morning', loop: true, seconds: 25, influence: 0.45, gain: 0.2,
    use: 'Dawn and early morning in dry weather.',
    prompt: 'Early morning birdsong in a city, heard faintly through a car window: a few sparrows and one blackbird, some way off, with very quiet street tone underneath. Gentle and sparse. Seamless loop.',
  },
  {
    id: 'snow_hush', loop: true, seconds: 25, influence: 0.45, gain: 0.4,
    use: 'Snow on the road while moving.',
    prompt: 'A car rolling slowly over packed snow, heard from inside: soft crunch and squeak under the tyres, deep muffled quiet all around, a very faint wind. Hushed and close. Seamless loop.',
  },

  // ---- the car itself
  {
    id: 'door_open', seconds: 3, influence: 0.6, gain: 0.8,
    use: 'A door lifts for a rider.',
    prompt: "An electric car's powered door opening, heard from the seat inside: a soft latch release click, then a smooth quiet servo whirr for about a second and a half as the door lifts, ending in a gentle stop. One-shot.",
  },
  {
    id: 'door_close', seconds: 2.5, influence: 0.6, gain: 0.85,
    use: 'A door comes down again.',
    prompt: "An electric car's powered door closing, heard from inside: a smooth servo whirr, then a solid padded thunk and the door seal compressing. One-shot.",
  },
  {
    id: 'seat', seconds: 1.5, influence: 0.6, gain: 0.6,
    use: 'A rider sits down.',
    prompt: 'Someone sitting down in a car seat: the rustle of a coat, a soft creak and squeak of a cushioned seat taking weight, a small shuffle to get comfortable. Close and dry. One-shot.',
  },
  {
    id: 'belt', seconds: 1.2, influence: 0.65, gain: 0.6,
    use: 'A seatbelt is fastened.',
    prompt: 'A car seatbelt being pulled across and buckled: a short zip of webbing, then one crisp metallic click. Close and dry. One-shot.',
  },
  {
    id: 'belt_off', seconds: 1.2, influence: 0.65, gain: 0.55,
    use: 'A seatbelt is released.',
    prompt: 'A car seatbelt being unbuckled: a button click, the belt retracting with a soft zip and a light tap as it stops. Close and dry. One-shot.',
  },
  {
    id: 'wiper', seconds: 1.3, influence: 0.6, gain: 0.5,
    use: 'One stroke of the wiper (played a little lower for the return stroke).',
    prompt: 'A single sweep of a car windscreen wiper heard from inside: a rubber blade squeegeeing across wet glass, then a soft thud as it reaches the end. One swipe only. One-shot.',
  },
  {
    id: 'blinker', seconds: 0.5, influence: 0.7, gain: 0.45,
    use: 'Each tick of the indicator (the game plays it lower for the tock).',
    prompt: 'One single soft turn-signal click from a modern electric car: short, dry, rounded, close. Just one click. One-shot.',
  },
  {
    id: 'pull_away', seconds: 2.5, influence: 0.55, gain: 0.45,
    use: 'Leaving the kerb.',
    prompt: 'An electric car pulling away from a standstill, heard from inside: a soft rising electric motor whine and the tyres beginning to roll. Smooth and quiet. One-shot.',
  },
  {
    id: 'stop', seconds: 1.5, influence: 0.55, gain: 0.4,
    use: 'Coming to rest.',
    prompt: 'An electric car coming to a gentle stop, heard from inside: a faint brake squeak and the suspension settling. Very soft. One-shot.',
  },
  {
    id: 'puddle', seconds: 2, influence: 0.6, gain: 0.5,
    use: 'Driving through standing water.',
    prompt: 'A car driving through a shallow puddle, heard from inside: a short heavy splash and a wash of water against the wheel arch. One-shot.',
  },

  // ---- the display
  {
    id: 'chime_request', seconds: 2, influence: 0.8, gain: 0.5,
    use: 'A new ride comes in. The model plays one note whatever it is asked, so the build plays that note twice: as recorded, then a fifth higher.',
    notes: [[0, 0], [0.17, 7]],
    prompt: 'A soft marimba plays one low note and then one higher note: a friendly two-note notification chime from a car touchscreen for a new ride request, rounded, clean and quiet. One-shot.',
  },
  {
    id: 'chime_pickup', seconds: 2.5, influence: 0.8, gain: 0.5,
    use: 'Arrived at the pick-up.',
    prompt: 'Three soft bell notes played one after another, each higher than the last: a calm rising chime from a premium electric car, warm synthesiser tones with a short soft tail. One-shot.',
  },
  {
    id: 'chime_arrive', seconds: 2.5, influence: 0.8, gain: 0.5,
    use: 'Arrived at the destination.',
    prompt: 'Three soft bell notes played one after another, each lower than the last: a calm descending arrival chime from a premium electric car, glassy tones with a short tail. One-shot.',
  },
  {
    id: 'ui_tap', seconds: 0.5, influence: 0.7, gain: 0.3,
    use: 'A button in the interface.',
    prompt: 'A tiny soft tap of a finger pressing a button on a car touchscreen: one short muted click, very quiet. One-shot.',
  },

  // ---- the street
  {
    id: 'pass_dry', seconds: 2.5, influence: 0.55, gain: 0.45,
    use: 'An oncoming car goes by on a dry road.',
    prompt: 'A car passing close by in the opposite direction on a dry city street, heard from inside another moving car: a quick whoosh with a short Doppler drop, muffled by the windows. One-shot.',
  },
  {
    id: 'pass_wet', seconds: 3, influence: 0.55, gain: 0.5,
    use: 'An oncoming car goes by in the wet.',
    prompt: 'A car passing close by on a wet street, heard from inside another car: a rush of tyre spray and hiss swelling and fading with a Doppler drop, muffled by the windows. One-shot.',
  },
  {
    id: 'horn_far', seconds: 2.5, influence: 0.5, gain: 0.25,
    use: 'Now and then, somewhere in the city.',
    prompt: 'A car horn sounding twice a few streets away in a city, distant and echoing between tall buildings, muffled as if heard through closed windows. One-shot.',
  },
  {
    id: 'siren_far', seconds: 9, influence: 0.5, gain: 0.22,
    use: 'Rarely, somewhere in the city.',
    prompt: 'An ambulance siren far away in a city, passing several blocks off, rising then fading with the echo of tall buildings, muffled through closed car windows. One-shot.',
  },
  {
    id: 'thunder_1', seconds: 8, influence: 0.55, gain: 0.9,
    use: 'A near strike.',
    prompt: 'One close thunderclap heard from inside a car: a sharp crack, then a long deep rolling rumble that slowly fades. One-shot.',
  },
  {
    id: 'thunder_2', seconds: 10, influence: 0.55, gain: 0.75,
    use: 'A far strike.',
    prompt: 'Distant thunder: a low, long, rolling rumble a few miles away, slowly dying out. One-shot.',
  },
  {
    id: 'thunder_3', seconds: 7, influence: 0.55, gain: 0.85,
    use: 'Overhead.',
    prompt: 'Thunder directly overhead heard from inside a car: a double crack, then a heavy rumble that shakes and dies away. One-shot.',
  },
];

/**
 * The radio. `mood` steers which track plays in which weather and at what hour.
 * Any other audio file dropped into public/audio/music/ joins the playlist too.
 */
export const MUSIC = [
  {
    id: 'rainy_window', title: 'Rainy Window', mood: ['rain', 'night'], seconds: 170,
    prompt: 'Instrumental lo-fi hip hop, 76 BPM, in D minor. Mellow, unhurried, the feeling of watching rain from a car at night. Dusty boom-bap drums with a soft brushed snare and swung hi-hats, warm round sub bass, a slightly detuned Rhodes electric piano playing jazzy minor ninth chords, and a sparse muted electric guitar answering it. Vinyl crackle, tape saturation and gentle wow and flutter throughout; the highs rolled off; everything sidechained softly to the kick. Start with crackle and Rhodes alone for eight bars, then bring in drums and bass, drop the drums for a short break two thirds through, and end by letting the Rhodes fade. Instrumental only, no vocals.',
  },
  {
    id: 'golden_hour', title: 'Golden Hour', mood: ['clear', 'evening'], seconds: 165,
    prompt: 'Instrumental lo-fi hip hop, 82 BPM, in F major. Warm and content, low sun through a windscreen. Laid-back swung drums with a rimshot and soft shaker, upright bass, a nylon-string guitar picking a gentle major seventh progression, and a warm analogue synth pad underneath. Tape hiss, light vinyl crackle, soft saturation, a slow low-pass filter opening over the first sixteen bars. Start with guitar alone, bring in bass and drums together, add a small wordless melody on electric piano in the second half, and end on a held guitar chord. Instrumental only, no vocals.',
  },
  {
    id: 'night_shift', title: 'Night Shift', mood: ['night', 'fog'], seconds: 180,
    prompt: 'Instrumental jazz-hop, 70 BPM, in A minor. Empty streets at two in the morning: smoky, slow, a little lonely but calm. Brushed drums with a lazy swing, upright bass walking gently, a soft felt piano playing sparse minor chords, and a muted trumpet far back in the mix with a long reverb. Vinyl crackle and room noise, warm tape compression, nothing bright. Open with bass and crackle, add piano, then drums; let the trumpet play one short phrase every eight bars; end with the bass alone. Instrumental only, no vocals.',
  },
  {
    id: 'first_light', title: 'First Light', mood: ['morning', 'clear'], seconds: 160,
    prompt: 'Instrumental lo-fi hip hop, 84 BPM, in E flat major. The city just waking up: light, hopeful, unhurried. Soft tight drums with a gentle clap and closed hats, round electric bass, a felt upright piano playing simple major ninth chords, and a kalimba picking out a small bright melody. Light tape wobble, quiet vinyl crackle, soft sidechain. Start with piano and a field recording of faint birdsong, bring in the drums after eight bars, add the kalimba in the second section, end with piano alone. Instrumental only, no vocals.',
  },
  {
    id: 'snow_day', title: 'Snow Day', mood: ['snow'], seconds: 165,
    prompt: 'Instrumental lo-fi hip hop, 68 BPM, in B flat major. Snow falling on a quiet city: hushed, soft, cosy. Very soft muffled drums with a brushed snare, deep warm sub bass, a celesta and a music box sharing a slow simple melody, and a warm string pad underneath. Heavy low-pass filtering, tape hiss, gentle wow and flutter, everything close and padded. Start with the music box alone, add the pad and bass, bring in the drums late, end with the music box slowing down. Instrumental only, no vocals.',
  },
  {
    id: 'red_light', title: 'Red Light', mood: ['cloudy', 'evening', 'rain'], seconds: 170,
    prompt: 'Instrumental lo-fi hip hop, 78 BPM, in G minor. Waiting at a red light with nowhere to be: a head-nodding, bass-led groove. Dusty kick and snare with finger snaps on the backbeat and swung sixteenth hi-hats, a melodic electric bass line up front, a Wurlitzer electric piano comping minor seventh chords, and a clean guitar playing short muted stabs. Vinyl crackle, tape saturation, a slow phaser on the keys, sidechain pumping. Start with the bass line and snaps, bring in the full kit, strip back to bass and keys for four bars in the middle, end by filtering everything down. Instrumental only, no vocals.',
  },
];

export const sfxFile = (id) => `sfx/${id}`;
export const musicFile = (id) => `music/${id}`;
export const riderFile = (riderId, clip) => `voice/${riderId}/${clip}`;
export const carFile = (id) => `voice/car/${id}`;
