/** Routes that fill the screen on their own: the root, which only redirects, and the landing-page studio. */
export const FRAMELESS_PATH = /^\/(?:landing-pages\/[^/]+\/studio\/?)?$/;

export function isFramelessPath(pathname: string): boolean {
  return FRAMELESS_PATH.test(pathname);
}
