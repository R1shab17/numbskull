// Global tuning. Everything gameplay-related lives here so it is easy to tweak.

export const VERSION = '1.0.0';
export const NET_VERSION = 3;
export const MAX_PLAYERS = 20;

// Quick play: public Battle Royale rooms that run back-to-back rounds.
export const PUBLIC = {
  slots: 12,              // public rooms anyone can land in
  fill: 12,               // bots top each round up to this many players
  intermission: 9,        // seconds on the results screen between rounds
  match: { mode: 'br', digits: 4, difficulty: 'normal', lives: 2, timeLimit: 300, scoreLimit: 1 },
};

export const CFG = {
  // reading & killing
  killRange: 44,          // metres you can "type-kill" someone without binoculars
  binoRange: 150,         // metres while looking through binoculars
  jamTime: 0.9,           // seconds you are locked out after a wrong number
  respawnTime: 3.5,
  spawnProtect: 2.0,      // seconds you can't be read after spawning
  blindKillThreshold: 0.45, // flash intensity above which you can't see anything

  // movement
  walkSpeed: 6.0,
  sprintMul: 1.45,
  crouchMul: 0.5,
  binoMul: 0.4,
  jumpVel: 6.9,
  gravity: 20,
  stepHeight: 0.52,
  radius: 0.38,
  standHeight: 1.85,
  crouchHeight: 1.25,
  eyeStand: 1.64,
  eyeCrouch: 1.06,
  foreheadStand: 1.78,    // height of the number note above feet
  foreheadCrouch: 1.2,

  // view
  fov: 78,
  binoFov: 15,

  // gadgets
  cameraCooldown: 7,
  photoTime: 4.5,
  throwSpeed: 19,
  grenadeGravity: 14,
  gadgets: {
    flash:    { start: 2, max: 3, fuse: 1.4, radius: 34, maxBlind: 4.0 },
    smoke:    { start: 2, max: 3, fuse: 1.1, radius: 5.8, life: 13 },
    distract: { start: 2, max: 3, fuse: 0.7, radius: 46, life: 6.5 },
  },
  pickupRespawn: 18,
};

export const GADGETS = ['flash', 'smoke', 'distract'];
export const GADGET_LABEL = { flash: 'Flashbang', smoke: 'Smoke', distract: 'Distract' };

export const MODES = {
  dm:  { id: 'dm',  name: 'Deathmatch',       short: 'DM',  teams: false, scoreLimit: 20, timeLimit: 300,
         blurb: 'Every head for themselves. First to the kill limit wins.' },
  tdm: { id: 'tdm', name: 'Team Deathmatch',  short: 'TDM', teams: true,  scoreLimit: 40, timeLimit: 420,
         blurb: 'Red vs Blue. Read the other team, protect your own foreheads.' },
  ctf: { id: 'ctf', name: 'Capture the Flag', short: 'CTF', teams: true,  scoreLimit: 3,  timeLimit: 600,
         blurb: 'Grab their flag, bring it home. Your own flag has to be at base to score.' },
  br:  { id: 'br',  name: 'Battle Royale',    short: 'BR',  teams: false, scoreLimit: 1,  timeLimit: 300,
         blurb: 'Every head for themselves while the zone closes in. Last one standing wins.' },
};

// Battle Royale zone: each stage waits, then shrinks to a fraction of the starting radius.
export const ZONE = {
  grace: 4,          // seconds you can survive outside the zone
  dropProtect: 8,    // nobody can be read for the first seconds of a round, so everyone can scatter
  stages: [
    { wait: 12, shrink: 18, to: 0.55 },
    { wait: 10, shrink: 16, to: 0.32 },
    { wait: 10, shrink: 15, to: 0.16 },
    { wait: 8, shrink: 14, to: 0.06 },
    { wait: 6, shrink: 16, to: 0 },
  ],
};

export const DIFFICULTY = {
  easy:   { name: 'Easy',   readTime: 1.7,  readRange: 15, msPerDigit: 430, mistake: 0.16, reaction: 0.75, turn: 3.2, fov: 95,  evade: 0.25, gadget: 0.25, distractable: 0.95, bino: 0.25 },
  normal: { name: 'Normal', readTime: 1.15, readRange: 19, msPerDigit: 320, mistake: 0.09, reaction: 0.5,  turn: 4.5, fov: 105, evade: 0.5,  gadget: 0.5,  distractable: 0.8,  bino: 0.5 },
  hard:   { name: 'Hard',   readTime: 0.8,  readRange: 23, msPerDigit: 230, mistake: 0.05, reaction: 0.32, turn: 6.0, fov: 115, evade: 0.75, gadget: 0.75, distractable: 0.6,  bino: 0.75 },
  insane: { name: 'Insane', readTime: 0.55, readRange: 27, msPerDigit: 165, mistake: 0.02, reaction: 0.2,  turn: 8.0, fov: 125, evade: 0.9,  gadget: 0.9,  distractable: 0.4,  bino: 0.9 },
};

export const TEAM = { NONE: 0, RED: 1, BLUE: 2 };
export const TEAM_NAME = ['', 'Red', 'Blue'];
export const TEAM_COLOR = ['#ffd84d', '#ff4f5e', '#3d7bff'];

export const SHIRT_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#ffffff', '#495057', '#a9e34b'];
export const SKIN_TONES = ['#ffdbc2', '#f5c6a5', '#e0a77e', '#c68a5e', '#9c6644', '#6f4630', '#ffe0bd', '#d7a77b'];
export const HATS = ['none', 'cap', 'beanie', 'party', 'tophat', 'propeller', 'crown', 'bucket'];
export const HAT_LABEL = { none: 'No hat', cap: 'Cap', beanie: 'Beanie', party: 'Party hat', tophat: 'Top hat', propeller: 'Propeller', crown: 'Crown', bucket: 'Bucket hat' };

export const BOT_NAMES = [
  'Squinty', 'Digit Dave', 'Sir Reads-a-Lot', 'Big Brow', 'Off-By-One', 'Quick Maths', 'Rounding Error',
  'Lil Calc', 'Abacus Abby', 'Sum Guy', 'Mathilda', 'Numberella', 'Tally Ho', 'Null Pointer',
  'Captain Forehead', 'Noodle', 'Pixel Pat', 'Divide & Conquer', 'Integer Ivy', 'Prime Time',
  'Decimal Dan', 'Ms Squint', 'Calculus Carl', 'Long Division', 'Binary Barb', 'Fractions',
];

export const STREAKS = { 2: 'Double read', 3: 'Triple read', 4: 'Speed reader', 5: 'Human calculator', 7: 'Unreadable', 10: 'NUMBSKULL' };
