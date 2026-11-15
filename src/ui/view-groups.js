// A mixed project (say Robotics + Bioelectronics + AI) has several groups of view tabs in the top bar: Assembly / Test, Visualizer, Train / Run model / Visualize.
// They must behave as one set: opening a tab in one group sends the others back to the circuit, and there is one Circuit button, not three.
const EVENT = 'cb-view-claim';

/** Called by each tab group. `getView()` says which view it shows now; `toCircuit()` sends it back; the returned `claim()` goes first thing in its own show(). */
export function joinViews(name, getView, toCircuit) {
  addEventListener(EVENT, e => { if (e.detail !== name && getView() !== 'circuit') toCircuit(); });
  return () => { try { dispatchEvent(new CustomEvent(EVENT, { detail: name })); } catch { /* no window (tests) */ } };
}

/** Keep the first visible Circuit button; hide the others, and dim it while another group's tab is the open one. */
export function tidyTabs(toolbar) {
  let busy = false;
  const tidy = () => {
    if (busy) return; busy = true;
    try {
      const all = [...toolbar.querySelectorAll('button[data-circuit-tab]')], live = all.filter(b => !b.hidden && !b.closest('.view-toggle')?.hidden);
      const other = [...toolbar.querySelectorAll('.view-toggle:not([hidden]) button.on:not([data-circuit-tab])')].length > 0;
      all.forEach(b => { const dup = live.indexOf(b) > 0, idle = live.indexOf(b) === 0 && other; if (b.classList.contains('dup') !== dup) b.classList.toggle('dup', dup); if (b.classList.contains('idle') !== idle) b.classList.toggle('idle', idle); });   // only touch what changed, or the observer would call this forever
    } finally { busy = false; }
  };
  const mo = new MutationObserver(() => queueMicrotask(tidy)); mo.observe(toolbar, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
  tidy(); return tidy;
}
