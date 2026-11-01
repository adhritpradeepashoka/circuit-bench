// The robot type of the open project, shared by the sidebar, the Assembly list, the Test tab and the AI. One place holds it; the project record keeps it.
import { cleanRobotType } from './robot-types.js';
let type = null, showAll = false; const listeners = [];
export const getRobotType = () => type;
export const showingAll = () => showAll;
export function setRobotType(id, { all = false } = {}) { const t = cleanRobotType(id); if (t === type && all === showAll) return; type = t; showAll = all; listeners.slice().forEach(fn => fn(type)); }
export function setShowAll(on) { if (showAll === !!on) return; showAll = !!on; listeners.slice().forEach(fn => fn(type)); }
export const onRobotType = fn => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn) >>> 0, 1); };
