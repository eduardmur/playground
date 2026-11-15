// Who rides, from where to where, and at what hours. Everyone in this city is a
// robot, the riders included; the car is the only one of them with no legs.
// Nobody says a word in the cab: a ride is a door, a belt, the road and the
// radio. What the cab knows about a regular is the line its notebook keeps.

/**
 * The regulars. One robot to a ride. `hours` limits a ride to part of the day: [from, to],
 * wrapping past midnight. `memory` is the line the Riders page shows once they have been carried.
 *
 * The robots all look much alike, so `look` is only the `frame` (the build: 'a' broad, 'b' slight),
 * an optional `build` ([width, height]), and anything they carry.
 */
export const RIDERS = [
  {
    id: 'maya', name: 'Maya', color: '#e0795b', from: 'tower', to: 'cafe', hours: [8, 20],
    look: { frame: 'b' },
    memory: 'Straight out of a job interview at Meridian Tower. She hears on Friday.',
  },
  {
    id: 'okafor', name: 'Mr. Okafor', color: '#7a9e7e', from: 'station', to: 'terrace',
    look: { frame: 'a', build: [1.04, 0.99] },
    memory: 'Thirty-one years at the wheel of a cab in this city, until the cabs lost their wheels.',
  },
  {
    id: 'priya', name: 'Priya', color: '#b06fd6', from: 'foundry', to: 'cobalt', hours: [19, 3.5],
    look: { frame: 'b', build: [0.97, 0.96] },
    memory: 'Home from a show at the Foundry, with her audio still clipping.',
  },
  {
    id: 'theo', name: 'Theo', color: '#8f7fd0', from: 'foundry', to: 'diner', hours: [19, 3.5],
    look: { frame: 'a' },
    memory: 'A full charge after the show, because time is not real in a diner.',
  },
  {
    id: 'lena', name: 'Lena', color: '#6aa6c9', from: 'hospital', to: 'cobalt',
    look: { frame: 'b' },
    memory: 'Home from a fourteen-hour shift at the repair clinic. Slowly is fine.',
  },
  {
    id: 'gus', name: 'Gus', color: '#e2b23c', from: 'studio', to: 'theater', hours: [15, 23.5],
    look: { frame: 'a', build: [1.03, 1.0] },
    memory: 'A comic on his way to the Orpheum with a new bit he has not tried on anyone.',
  },
  {
    id: 'june', name: 'June', color: '#d98aa4', from: 'market', to: 'lofts', hours: [9, 20],
    look: { frame: 'b', build: [1, 0.94] },
    memory: 'A flask of warm oil across town, for a grandson running hot.',
  },
  {
    id: 'sam', name: 'Sam', color: '#58b89a', from: 'library', to: 'hall', hours: [7, 22],
    look: { frame: 'b', build: [0.95, 0.95] },
    memory: 'Late for an exam on cell chemistry, and sure of failing it.',
  },
  {
    id: 'rafael', name: 'Rafael', color: '#c7714a', from: 'records', to: 'park', hours: [10, 21.5],
    look: { frame: 'a' },
    memory: 'On his way to Linden Park with a ring in his compartment.',
  },
  {
    id: 'bea', name: 'Bea', color: '#5c8fd6', from: 'pier', to: 'hotel', hours: [8, 22],
    look: { frame: 'b', build: [1.04, 0.95] },
    memory: 'On holiday, and taking all of it in from the window.',
  },
  {
    id: 'tom', name: 'Tom', color: '#7d8fb0', from: 'market', to: 'hotel', hours: [8, 22],
    look: { frame: 'a', build: [1.06, 1.0] },
    memory: 'Sent across town for the good oil.',
  },
  {
    id: 'noor', name: 'Noor', color: '#8a8fa8', from: 'cobalt', to: 'pier',
    look: { frame: 'b' },
    memory: 'Five quiet minutes to the pier after a long day, all hers.',
  },
  {
    id: 'dev', name: 'Dev', color: '#4fb0c6', from: 'hotel', to: 'station', hours: [6, 19],
    look: { frame: 'a' },
    memory: 'A founder with four months of charge left in the company, and a train to catch.',
  },
  {
    id: 'hana', name: 'Hana', color: '#e39a4a', from: 'terrace', to: 'bakery', hours: [4.5, 8.5],
    look: { frame: 'b', build: [0.98, 0.94] },
    memory: 'A baker before dawn, on her way to an oven of cells that formed all night.',
  },
  {
    id: 'kit', name: 'Kit', color: '#f08a7c', from: 'bakery', to: 'hotel', hours: [9, 19],
    look: { frame: 'a', cake: true },
    memory: 'Three tiers of buttercream across town, for a wedding where nobody can eat it. Not a crumb out of place.',
  },
  {
    id: 'ellis', name: 'Ellis', color: '#9bb0c9', from: 'lofts', to: 'diner', hours: [21, 4.5],
    look: { frame: 'b', build: [0.98, 0.98] },
    memory: 'A novelist who cannot sleep, off the charger and on her way to the diner.',
  },
];
