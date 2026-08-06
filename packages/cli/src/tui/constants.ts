import kleur from 'kleur';

const BAR_FILLED = '██████';
const BAR_EMPTY  = '░░░░░░';

export function scoreBar(score: number, cols: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, score)) * 6);
  if (cols < MIN_WIDTH_SCORE_BAR) return '';
  return kleur.green(BAR_FILLED.slice(0, filled)) + kleur.dim(BAR_EMPTY.slice(0, 6 - filled));
}

export const Colors = {
  cursor:   (s: string) => kleur.bgBlue().white(s),
  selected: (s: string) => kleur.green(s),
  dep:      (s: string) => kleur.cyan(s),
  dim:      (s: string) => kleur.dim(s),
  amber:    (s: string) => kleur.yellow(s),
  badge:    (s: string) => kleur.dim(s),
  normal:   (s: string) => s,
};

export const FOOTER_BROWSE       = 'space:toggle  d:+deps  /:search  s:save  l:load  a:all  n:none  r:sort  o:open  enter:pack  q:quit';
export const FOOTER_SEARCH       = 'type to filter  esc:cancel  enter:pack';
export const FOOTER_PROFILE_SAVE = 'type profile name  enter:save  esc:cancel';
export const FOOTER_PROFILE_LOAD = '↑↓:navigate  enter:load  esc:cancel';

// Column collapse thresholds (terminal columns)
export const MIN_WIDTH_SCORE_BAR = 90;
export const MIN_WIDTH_TOKENS    = 70;
export const MIN_WIDTH_PATH      = 60;
