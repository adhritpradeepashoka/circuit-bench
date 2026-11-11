// Absolute-coordinate path parser: an SVG path string → the bounding box of each of its subpaths (used to find header pads and LEDs in Arduino board drawings).
export function parseAbs(d) {
  const subs = []; let cur = null, i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
  const num = () => { const m = /^[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/.exec(d.slice(i)); if (!m) return null; i += m[0].length; return parseFloat(m[1]); };
  const flag = () => { while (/[\s,]/.test(d[i])) i++; const v = d[i] === '1' ? 1 : 0; i++; return v; };
  const add = (x, y) => { if (!cur) { cur = []; subs.push(cur); } cur.push([x, y]); };
  while (i < d.length) {
    while (i < d.length && /[\s,]/.test(d[i])) i++; if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) { cmd = d[i++]; if (/[zZ]/.test(cmd)) { cx = sx; cy = sy; cur = null; continue; } }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toLowerCase(), ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'm') { const x = num() + ox, y = num() + oy; cur = null; add(x, y); cx = sx = x; cy = sy = y; cmd = rel ? 'l' : 'L'; }
    else if (C === 'l') { const x = num() + ox, y = num() + oy; add(x, y); cx = x; cy = y; }
    else if (C === 'h') { const x = num() + ox; add(x, cy); cx = x; }
    else if (C === 'v') { const y = num() + oy; add(cx, y); cy = y; }
    else if (C === 'c') { const a = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy]; add(a[4], a[5]); cx = a[4]; cy = a[5]; }
    else if (C === 's' || C === 'q') { const a = [num() + ox, num() + oy, num() + ox, num() + oy]; add(a[2], a[3]); cx = a[2]; cy = a[3]; }
    else if (C === 't') { const x = num() + ox, y = num() + oy; add(x, y); cx = x; cy = y; }
    else if (C === 'a') { const rx = num(), ry = num(); num(); flag(); flag(); const x = num() + ox, y = num() + oy; add(x, y); cx = x; cy = y; }
    else break;
  }
  return subs.map(pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; });
}
