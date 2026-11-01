// The first thing a new robotics project asks: what are you making? A card in the middle of the screen with a few big choices.
// The answer is saved with the project and shapes the parts lists, the AI and the Test tab (see core/robot-types.js).
import { ROBOT_TYPES, robotType } from '../core/robot-types.js';
import { getRobotType } from '../core/robot-context.js';

export function initRobotType({ editor, projects, onChosen = () => {} }) {
  const root = document.createElement('div');
  root.className = 'rt-modal'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'rtTitle');
  const card = document.createElement('div'); card.className = 'rt-card';
  const h = document.createElement('h2'); h.id = 'rtTitle'; h.textContent = 'What do you want to make?';
  const sub = document.createElement('p'); sub.className = 'rt-sub'; sub.textContent = 'Pick one. CircuitBench will show the parts, tests and help that fit it. You can change this any time.';
  const grid = document.createElement('div'); grid.className = 'rt-grid';
  for (const t of ROBOT_TYPES) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'rt-choice'; b.dataset.type = t.id;
    const ic = document.createElement('span'); ic.className = 'rt-icon'; ic.textContent = t.icon; ic.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('b'); nm.textContent = t.name; const bl = document.createElement('span'); bl.textContent = t.blurb;
    b.append(ic, nm, bl); b.addEventListener('click', () => choose(t.id)); grid.append(b);
  }
  const later = document.createElement('button'); later.type = 'button'; later.className = 'link-btn rt-later'; later.textContent = 'Decide later'; later.addEventListener('click', close);
  card.append(h, sub, grid, later); root.append(card); document.body.append(root);

  function open() { for (const b of grid.children) b.classList.toggle('on', b.dataset.type === getRobotType()); root.hidden = false; (grid.querySelector('.on') || grid.firstElementChild)?.focus(); }
  function close() { root.hidden = true; }
  async function choose(id) {
    close(); await projects.setRobotType(id); const t = robotType(id);
    editor.status(id === 'standalone' ? 'Showing every part. Ask the AI or add parts to start.' : `${t.name}: the parts, the 3D list, the AI and the Test tab now fit it.`);
    onChosen(id);
  }
  root.addEventListener('click', e => { if (e.target === root) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });
  editor.on('robotics-created', open); editor.on('pick-robot-type', open);
  return { open, close, choose };
}
