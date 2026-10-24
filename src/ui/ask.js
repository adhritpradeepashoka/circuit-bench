// Questions the app asks you ("Delete this class?", "Hand in?") shown as a proper full-screen page, not a browser pop-up.
// ask({ title, body, yes, no, danger, input }) → true / false, or (with `input`) the typed text / null.
export function ask({ title = 'Are you sure?', body = '', yes = 'OK', no = 'Cancel', danger = false, input = null } = {}) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const root = document.createElement('div'); root.className = 'ask'; root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', title);
    const card = document.createElement('div'); card.className = 'ask-card';
    const h = document.createElement('h1'); h.textContent = title; card.append(h);
    if (body) { const p = document.createElement('p'); p.textContent = body; card.append(p); }
    let field = null;
    if (input) { field = document.createElement('textarea'); field.rows = 3; field.maxLength = 500; field.placeholder = input.placeholder || ''; field.setAttribute('aria-label', input.label || title); card.append(field); }
    const row = document.createElement('div'); row.className = 'ask-row';
    const bn = document.createElement('button'), by = document.createElement('button');
    bn.type = by.type = 'button'; bn.className = 'cls-btn big'; by.className = `cls-btn big ${danger ? 'danger-fill' : 'primary'}`; bn.textContent = no; by.textContent = yes;
    const done = v => { document.removeEventListener('keydown', onKey, true); root.remove(); try { prevFocus?.focus?.(); } catch { /* ignore */ } resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(input ? null : false); } };
    bn.addEventListener('click', () => done(input ? null : false)); by.addEventListener('click', () => done(input ? field.value : true));
    document.addEventListener('keydown', onKey, true);
    row.append(bn, by); card.append(row); root.append(card); document.body.append(root);
    (field || bn).focus();
  });
}
