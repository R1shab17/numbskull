// Words the game shows during a match. A map pack's theme can swap any of them
// (theme.lingo.text), rename the teams and gadgets, and change the streak calls.
// Placeholders like {name} are filled in by say().
import { TEAM_NAME, TEAM_COLOR, GADGET_LABEL, STREAKS, MODES } from './config.js';

const BASE = {
  hit: 'Read {name}!',
  hitFar: 'Read {name}! {dist} m away',
  peelHit: "Ripped {name}'s note off. New number underneath!",
  peeled: 'Note ripped off! New number: {num}',
  peelFeed: 'note ripped',
  miss_nobody: 'Nobody has that number',
  miss_sight: "They're not in sight",
  miss_self: "That's your own number",
  miss_team: "That's a teammate",
  miss_protected: "They're shielded for a moment",
  miss_decoy: 'That was a decoy',
  miss_wait: 'Not yet!',
  miss: 'Miss',
  go: 'GO!',
  getReady: 'GET READY',
  win: 'YOU WIN',
  brWin: 'LAST HEAD STANDING',
  over: 'MATCH OVER',
  deathLabel: 'You got read',
  readBy: 'Read by {name}',
  zoneDeath: 'Caught by the zone',
  zoneFeed: '{name} got caught by the zone',
  zoneSoon: 'Zone starts shrinking soon',
  zoneWait: 'Zone shrinks in {t}',
  zoneShrink: 'Zone is shrinking',
  zoneFinal: 'Final zone',
  outside: 'Outside the zone',
  onYourHead: 'On your head',
  typeHint: "Type the number on someone's forehead",
  colReads: 'Reads',
  colOut: 'Out',
  colDeaths: 'Deaths',
  colMisses: 'Misses',
  colBest: 'Best streak',
  colFastest: 'Fastest read',
  endYouWin: 'You win',
  endWins: '{name} wins',
  endBrYou: 'Last head standing',
  endTeamWins: '{team} team wins',
  endDraw: 'Draw',
  endWinSub: 'Human calculator.',
  endLoseSub: 'Better luck next time.',
  endTeamWinSub: 'Nice reading.',
  endTeamLoseSub: 'They had your number.',
  // with a champion title set, the winner is crowned on the scoreboard and results
  champion: '',
  championYou: "You're the {title}",
  championIs: '{name} is the {title}',
  championTeam: '{team} are the {title}s',
};

export const L = { ...BASE };
const saved = { teams: [...TEAM_NAME], colors: [...TEAM_COLOR], gadgets: { ...GADGET_LABEL }, streaks: { ...STREAKS }, blurbs: Object.fromEntries(Object.values(MODES).map(m => [m.id, m.blurb])) };

export function say(key, vars = {}) {
  const s = L[key] ?? BASE[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

// o: { text: {key: string}, teams: ['', 'Red', 'Blue'], teamColors: [...], gadgets: {flash: '...'}, streaks: {2: '...'},
//      modes: {tdm: 'blurb'}, champion }
export function setLingo(o) {
  for (const k of Object.keys(L)) delete L[k];
  Object.assign(L, BASE, (o && o.text) || {});
  if (o && o.champion) L.champion = o.champion;
  const teams = (o && o.teams) || saved.teams, colors = (o && o.teamColors) || saved.colors;
  for (let i = 0; i < saved.teams.length; i++) { TEAM_NAME[i] = teams[i] ?? saved.teams[i]; TEAM_COLOR[i] = colors[i] ?? saved.colors[i]; }
  Object.assign(GADGET_LABEL, saved.gadgets, (o && o.gadgets) || {});
  for (const k of Object.keys(STREAKS)) delete STREAKS[k];
  Object.assign(STREAKS, (o && o.streaks) || saved.streaks);
  for (const m of Object.values(MODES)) m.blurb = (o && o.modes && o.modes[m.id]) || saved.blurbs[m.id];
}
