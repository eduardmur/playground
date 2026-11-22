// What the passenger set, kept between visits.
const KEY = 'train.settings';

export interface Settings {
  hour: number;
  drift: boolean;
  radio: boolean;
  station: string;
  volRadio: number;
  volTrain: number;
  muted: boolean;
  focus: number; // minutes
  rest: number;
  long: number;
  rounds: number;
}

const defaults: Settings = {
  hour: 9.4,
  drift: false,
  radio: true,
  station: 'morning',
  volRadio: 0.5,
  volTrain: 0.7,
  muted: false,
  focus: 25,
  rest: 5,
  long: 15,
  rounds: 4,
};

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // private windows, blocked storage: carry on with the defaults
  }
  return { ...defaults };
}

export const settings: Settings = read();

let pending = 0;
export function save() {
  if (pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // nothing to be done
    }
  }, 300);
}
