// A navy veil over everything (the casino screen included), for scene changes: entering and leaving the casino dims
// the town to navy, swaps what's behind, and lifts again. Navy #1E1B3A, the UI's outline colour.

let veil: HTMLElement | null = null;

/** Fades the veil to `opacity` (0–1) over `ms`; resolves when it's there. */
export function fadeNavy(opacity: number, ms: number): Promise<void> {
  if (!veil) {
    veil = document.createElement('div');
    veil.id = 'navy-fade';
    veil.setAttribute('aria-hidden', 'true');
    document.body.append(veil);
  }
  const v = veil;
  v.style.transition = 'none';
  void v.offsetWidth; // apply the start before the transition
  v.style.transition = `opacity ${ms}ms linear`;
  v.style.opacity = String(opacity);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
