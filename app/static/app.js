'use strict';

/* ------------------------------------------------------------------ state */

// Every field the app knows about comes from GET /api/schema (app.main.FIELD_SPECS).
// Nothing about listing fields is hardcoded here — that's what stops the table, the
// drawer and the manual-entry form drifting apart.
const state = {
  listings: [],
  properties: [],
  searches: [],
  schema: { fields: [], statuses: [], sources: [] },
  filters: { statuses: new Set(), source: '', q: '', maxPrice: null, showInactive: false },
  sort: { key: 'id', dir: 'desc' },
  selectedId: null,
};

/* -------------------------------------------------------------------- api */

// Set on beforeunload so any last-gasp save is sent with keepalive, which stops
// the browser cancelling it as the page goes away.
let unloading = false;

async function api(method, path, body) {
  const opts = { method, headers: {}, keepalive: unloading };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error((data && data.detail) || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b);
const patch = (p, b) => api('PATCH', p, b);
const del = (p) => api('DELETE', p);

/* ------------------------------------------------------------------ utils */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toast(message, kind) {
  const node = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: message });
  $('#toasts').append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 6000 : 3500);
}

function money(value) {
  if (value === null || value === undefined) return '';
  return '£' + Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

function number(value) {
  if (value === null || value === undefined) return '';
  return Number(value).toLocaleString('en-GB');
}

function formatReg(reg) {
  if (!reg) return '';
  return reg.length === 7 ? reg.slice(0, 4) + ' ' + reg.slice(4) : reg;
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function todayIso() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}

/** First `words` words of `text`, with an ellipsis if anything was dropped. */
function truncateWords(text, words) {
  const parts = (text || '').split(' ').filter(Boolean);
  if (parts.length <= words) return parts.join(' ');
  return parts.slice(0, words).join(' ') + '…';
}

/** Debounced `fn`, with `.flush()` to run a pending call right now (or nothing). */
function debounce(fn, ms) {
  let timer, pending = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    pending = args;
    timer = setTimeout(() => { pending = null; fn(...args); }, ms);
  };
  wrapped.flush = () => {
    if (!pending) return;
    clearTimeout(timer);
    const args = pending;
    pending = null;
    fn(...args);
  };
  return wrapped;
}

function errorMessage(err) {
  return err && err.message ? err.message : 'Something went wrong';
}

/* ----------------------------------------------------------------- schema */

function fieldSpec(key) {
  return state.schema.fields.find((f) => f.key === key) || null;
}

/** Pretty label for a select value, from the spec's `labels` map. */
function specLabel(spec, value) {
  if (!spec) return value;
  return (spec.labels && spec.labels[value]) || value;
}

function statusLabel(value) {
  return specLabel(fieldSpec('status'), value);
}

/* ---------------------------------------------------------------- columns */

// Amendment 01 §A column order, now owned by the backend registry. The table is
// read-only: the only clickable thing in a row is the title link (opens the
// original listing); everything else opens the drawer, where editing happens.
// Custom properties are appended after the registry's columns, in their own order.
function columns() {
  const base = state.schema.fields.filter((f) => f.in_table !== false);
  const custom = state.properties.map((p) => ({
    key: 'custom:' + p.key, label: p.label, property: p, numeric: p.type === 'number',
  }));
  return [...base, ...custom];
}

/* ----------------------------------------------------------------- filters */

function visibleListings() {
  const f = state.filters;
  let rows = state.listings.filter((l) => {
    if (!f.showInactive && !l.is_active) return false;
    if (f.statuses.size && !f.statuses.has(l.status)) return false;
    if (f.source && l.source !== f.source) return false;
    if (f.q && !(l.title || '').toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.maxPrice !== null && l.price_gbp !== null && l.price_gbp > f.maxPrice) return false;
    return true;
  });

  const { key, dir } = state.sort;
  const col = columns().find((c) => c.key === key);
  const sign = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = sortValue(a, key), vb = sortValue(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;   // blanks always sink
    if (vb === null) return -1;
    if (col && col.numeric) return (va - vb) * sign;
    return String(va).localeCompare(String(vb), 'en-GB', { numeric: true }) * sign;
  });
  return rows;
}

function sortValue(listing, key) {
  if (key === 'id') return listing.id;
  if (key.startsWith('custom:')) {
    const value = listing.custom[key.slice(7)];
    return value === undefined || value === '' ? null : value;
  }
  const value = listing[key];
  return value === undefined || value === '' ? null : value;
}

/* ------------------------------------------------------------ table render */

function renderHeader() {
  const row = $('#header-row');
  row.replaceChildren(...columns().map((col) => {
    const active = state.sort.key === col.key;
    const arrow = active ? (state.sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return el('th', {
      text: col.label + arrow,
      onclick: col.sortable === false ? null : () => {
        if (state.sort.key === col.key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        else state.sort = { key: col.key, dir: 'asc' };
        render();
      },
    });
  }));
}

function renderRows() {
  const rows = visibleListings();
  const body = $('#listings-body');
  body.replaceChildren(...rows.map(renderRow));
  $('#empty-state').classList.toggle('hidden', state.listings.length > 0);
  $('#row-count').textContent = rows.length + (rows.length === 1 ? ' listing' : ' listings');
}

function renderRow(listing) {
  const tr = el('tr', {
    dataset: { id: listing.id },
    class: [
      listing.status === 'rejected' ? 'dim' : '',
      listing.is_active ? '' : 'inactive',
      state.selectedId === listing.id ? 'selected' : '',
    ].filter(Boolean).join(' '),
    onclick: (event) => {
      // The title link is the one thing in a row that isn't "open the drawer".
      if (event.target.closest('a')) return;
      openDrawer(listing.id);
    },
  });
  tr.append(...columns().map((col) => renderCell(listing, col)));
  return tr;
}

function renderCell(listing, col) {
  if (col.key.startsWith('custom:')) return customCell(listing, col);

  const value = listing[col.key];
  const plain = (text) => el('td', { class: 'val' + (col.numeric ? ' num' : ''), text });

  switch (col.cell) {
    case 'thumb': {
      const src = listing.image_urls[0];
      return el('td', { class: 'open-cell', title: 'Open details' },
        src ? el('img', { class: 'thumb', src, loading: 'lazy', alt: '' }) : el('div', { class: 'thumb-empty' }));
    }

    case 'title_link': {
      const td = el('td', { class: 'title-cell' });
      td.append(listing.url
        ? el('a', { href: listing.url, target: '_blank', rel: 'noopener', text: listing.title, title: 'Open the original listing' })
        : document.createTextNode(listing.title));
      return td;
    }

    case 'badge':
      return el('td', {}, el('span', {
        class: 'badge ' + value,
        text: value === 'ebay' ? 'eBay' : value === 'facebook' ? 'FB' : 'Manual',
      }));

    case 'status_pill':
      return el('td', {}, el('span', {
        class: 'status-pill st-' + value,
        text: statusLabel(value),
      }));

    case 'mot':
      // MOT data isn't stored on the listing yet (milestone 5); the drawer holds
      // the Check button, so this column is a placeholder until then.
      return el('td', { class: 'muted', text: listing.reg ? '—' : 'add reg' });

    case 'mot_due': {
      // Stored as an ISO date; shown short, and flagged once it's in the past.
      if (!value) return el('td', { class: 'val' });
      const overdue = value < todayIso();
      return el('td', {
        class: 'val mot-due' + (overdue ? ' overdue' : ''),
        text: formatDate(value),
        title: overdue ? 'MOT expired' : 'MOT due',
      });
    }

    case 'notes': {
      // A few words only — the full text lives in the drawer, and long notes must
      // not stretch the row.
      const full = (value || '').replace(/\s+/g, ' ').trim();
      const td = el('td', { class: 'notes-cell', text: truncateWords(full, 5) });
      if (full) td.title = full;
      return td;
    }

    case 'check':
      return el('td', { class: 'val', text: value === true ? '✓' : '' });

    case 'money':
      return plain(money(value));

    case 'number':
      // `grouped: false` on the spec means "print it raw" — a year, not a quantity.
      return plain(value === null || value === undefined ? ''
        : col.grouped === false ? String(value) : number(value));

    case 'reg':
      return plain(formatReg(value));

    case 'date':
      return plain(formatDate(value));

    default:
      return plain(value === null || value === undefined ? '' : String(value));
  }
}

function customCell(listing, col) {
  const prop = col.property;
  const value = listing.custom[prop.key];

  if (prop.type === 'checkbox') {
    return el('td', { class: 'val', text: value === true ? '✓' : '' });
  }
  return el('td', {
    class: 'val' + (prop.type === 'number' ? ' num' : ''),
    text: value === undefined || value === null ? '' : String(value),
  });
}

/* ------------------------------------------------------------------- save */

async function saveField(listing, field, value) {
  const updated = await patch(`/api/listings/${listing.id}`, { [field]: value });
  Object.assign(listing, updated);
  return updated;
}

/* ----------------------------------------------------------------- drawer */

// The notes textarea autosaves on a debounce; this holds the pending save so
// closing the drawer or leaving the page can flush it instead of dropping it.
let pendingNotesSave = null;

function flushNotes() {
  if (pendingNotesSave) pendingNotesSave.flush();
}

function openDrawer(id) {
  state.selectedId = id;
  $('#drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
  renderDrawer();
  renderRows();
}

function closeDrawer() {
  flushNotes();
  state.selectedId = null;
  $('#drawer').classList.add('hidden');
  $('#drawer-backdrop').classList.add('hidden');
  renderRows();
}

const NUMERIC_TYPES = ['number', 'integer', 'money'];

/** One editable drawer control, derived entirely from the field spec's `type`. */
function drawerField(listing, spec) {
  const key = spec.key;
  const save = async (value) => {
    try {
      await saveField(listing, key, value);
      renderRows();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  const value = listing[key];

  let input;
  if (spec.type === 'select') {
    input = el('select', { onchange: (e) => save(e.target.value === '' ? null : e.target.value) },
      [el('option', { value: '', text: '' }),
       ...(spec.options || []).map((o) => el('option', {
         value: o, text: specLabel(spec, o), selected: o === value,
       }))]);
  } else if (spec.type === 'checkbox') {
    input = el('input', { type: 'checkbox', checked: value === true, onchange: (e) => save(e.target.checked) });
  } else if (spec.type === 'urls') {
    input = el('textarea', { rows: 4, onchange: (e) => save(e.target.value) });
    input.value = (value || []).join('\n');
  } else if (spec.type === 'textarea') {
    input = el('textarea', { rows: 6, onchange: (e) => save(e.target.value) });
    input.value = value ?? '';
  } else {
    const numeric = NUMERIC_TYPES.includes(spec.type);
    input = el('input', {
      type: numeric ? 'number' : spec.type === 'date' ? 'date' : 'text',
      value: value ?? '',
      onchange: (e) => {
        const raw = e.target.value;
        save(raw === '' ? null : (numeric ? Number(raw) : raw));
      },
    });
  }
  return el('div', { class: 'field' }, el('label', { text: spec.label }), input);
}

/** Reg + plate lookup (the lookup endpoint activates once DVSA/DVLA keys exist). */
function drawerRegField(listing, spec) {
  const regInput = el('input', {
    value: formatReg(listing.reg), onchange: async (e) => {
      try { await saveField(listing, 'reg', e.target.value || null); renderDrawer(); renderRows(); }
      catch (err) { toast(errorMessage(err), 'error'); }
    },
  });
  const lookupMsg = el('p', { class: 'hint' });
  return el('div', { class: 'field' },
    el('label', { text: 'Number plate' }),
    el('div', { class: 'row' }, regInput, el('button', {
      class: 'btn', text: 'Look up plate', onclick: () => lookupPlate(regInput.value, lookupMsg, listing),
    })),
    lookupMsg);
}

/** Notes: no label, big box, autosaved on a debounce with a Saving…/Saved hint. */
function drawerNotesField(listing) {
  const savedHint = el('div', { class: 'save-hint' });
  // Notes absorbed the old read-only description field, so give it room.
  const notes = el('textarea', { rows: 14 });
  notes.value = listing.notes || '';
  const autosave = debounce(async () => {
    try {
      await saveField(listing, 'notes', notes.value);
      savedHint.textContent = 'Saved';
      setTimeout(() => { savedHint.textContent = ''; }, 1500);
      renderRows();
    } catch (err) { toast(errorMessage(err), 'error'); }
  }, 800);
  pendingNotesSave = autosave;
  notes.addEventListener('input', () => { savedHint.textContent = 'Saving…'; autosave(); });
  notes.addEventListener('blur', () => autosave.flush());
  return el('div', { class: 'field' }, notes, savedHint);
}

/** A field the API won't let anyone change (source): shown, but not editable. */
function drawerReadonlyField(listing, spec) {
  return el('div', { class: 'field' },
    el('label', { text: spec.label }),
    el('input', { value: specLabel(spec, listing[spec.key]) ?? '', disabled: true }));
}

function drawerFieldFor(listing, spec) {
  if (spec.widget === 'reg_lookup') return drawerRegField(listing, spec);
  if (spec.widget === 'notes') return drawerNotesField(listing);
  if (!spec.editable) return drawerReadonlyField(listing, spec);
  return drawerField(listing, spec);
}

// Drawer section order. 'Custom' isn't a registry section — it's the user-defined
// properties from /api/properties, slotted in between Images and Notes.
const DRAWER_SECTIONS = ['Details', 'Images', 'Custom', 'Notes', 'MOT'];

/** The specs rendered under a section heading, in registry order. */
function sectionFields(name) {
  return state.schema.fields.filter((f) =>
    // `source` has no section (it isn't an input) but still belongs in Details.
    f.section === name || (name === 'Details' && f.key === 'source'));
}

function renderDrawer() {
  const listing = state.listings.find((l) => l.id === state.selectedId);
  if (!listing) return closeDrawer();

  $('#drawer-title').textContent = listing.title;
  const body = $('#drawer-body');
  const parts = [];

  if (listing.image_urls.length) {
    parts.push(el('div', { class: 'image-strip' }, listing.image_urls.map((src) =>
      el('img', { src, alt: '', onclick: () => window.open(src, '_blank', 'noopener') }))));
  }

  if (listing.url) {
    parts.push(el('p', {}, el('a', { href: listing.url, target: '_blank', rel: 'noopener', text: 'Open original listing ↗' })));
  }

  for (const name of DRAWER_SECTIONS) {
    if (name === 'Custom') {
      if (!state.properties.length) continue;
      parts.push(el('div', { class: 'section-title', text: 'Custom' }));
      for (const prop of state.properties) parts.push(drawerCustomField(listing, prop));
      continue;
    }
    const specs = sectionFields(name);
    if (!specs.length) continue;
    parts.push(el('div', { class: 'section-title', text: name }));
    for (const spec of specs) parts.push(drawerFieldFor(listing, spec));
  }

  // The MOT section's Check button hangs off the end of that section.
  parts.push(el('div', { class: 'field' },
    el('button', {
      class: 'btn', text: listing.reg ? 'Check MOT' : 'Add a reg first',
      disabled: !listing.reg,
      onclick: async () => {
        try { await post(`/api/listings/${listing.id}/mot`); }
        catch (err) { toast(errorMessage(err), 'error'); }
      },
    })));

  const actions = el('div', { class: 'drawer-actions' });
  if (listing.source === 'ebay') {
    actions.append(el('button', {
      class: 'btn', text: 'Check listing live',
      onclick: async () => {
        try { await post(`/api/listings/${listing.id}/check`); }
        catch (err) { toast(errorMessage(err), 'error'); }
      },
    }));
  }
  actions.append(el('button', {
    class: 'btn danger', text: 'Delete',
    onclick: async () => {
      if (!confirm('Delete this listing? This cannot be undone.')) return;
      try {
        await del(`/api/listings/${listing.id}`);
        state.listings = state.listings.filter((l) => l.id !== listing.id);
        closeDrawer();
        render();
        toast('Listing deleted');
      } catch (err) { toast(errorMessage(err), 'error'); }
    },
  }));
  parts.push(actions);

  body.replaceChildren(...parts);
}

function drawerCustomField(listing, prop) {
  const value = listing.custom[prop.key];
  const save = async (raw) => {
    try {
      const updated = await patch(`/api/listings/${listing.id}`, { custom: { [prop.key]: raw } });
      Object.assign(listing, updated);
      renderRows();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  let input;
  if (prop.type === 'checkbox') {
    input = el('input', { type: 'checkbox', checked: value === true, onchange: (e) => save(e.target.checked) });
  } else if (prop.type === 'select') {
    input = el('select', { onchange: (e) => save(e.target.value || null) },
      [el('option', { value: '', text: '' }),
       ...prop.options.map((o) => el('option', { value: o, text: o, selected: value === o }))]);
  } else if (prop.type === 'date') {
    input = el('input', { type: 'date', value: value || '', onchange: (e) => save(e.target.value || null) });
  } else {
    input = el('input', {
      type: prop.type === 'number' ? 'number' : 'text',
      value: value ?? '',
      onchange: (e) => save(e.target.value === '' ? null : e.target.value),
    });
  }
  return el('div', { class: 'field' }, el('label', { text: prop.label }), input);
}

/* ------------------------------------------------------------ plate lookup */

async function lookupPlate(reg, msgNode, listing) {
  const cleaned = (reg || '').replace(/\s+/g, '').toUpperCase();
  msgNode.className = 'hint';
  if (!cleaned) { msgNode.textContent = 'Enter a number plate first'; return; }
  msgNode.textContent = 'Looking up…';
  try {
    const result = await post('/api/lookup/reg', { reg: cleaned });
    const fill = {};
    for (const field of ['make', 'model', 'year', 'length_code', 'height_code']) {
      if (result[field] && listing && !listing[field]) fill[field] = result[field];
    }
    if (listing) {
      fill.reg = cleaned;
      const updated = await patch(`/api/listings/${listing.id}`, fill);
      Object.assign(listing, updated);
      renderDrawer();
      renderRows();
    }
    msgNode.className = 'hint ok';
    msgNode.textContent = `${result.make || ''} ${result.model || ''}`.trim() || 'Found';
    return result;
  } catch (err) {
    msgNode.className = 'hint error';
    msgNode.textContent = err.status === 404 ? 'No record found for this plate' : errorMessage(err);
    return null;
  }
}

/* ----------------------------------------------------------------- modals */

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
function closeAllModals() { $$('.modal').forEach((m) => m.classList.add('hidden')); }

function setupModals() {
  $$('.modal-close').forEach((btn) => btn.addEventListener('click', () => closeAllModals()));
  $$('.modal').forEach((modal) => modal.addEventListener('click', (e) => {
    if (e.target === modal) closeAllModals();
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$$('.modal:not(.hidden)').length) { if (state.selectedId) closeDrawer(); return; }
    closeAllModals();
  });
}

/* ------------------------------------------------------- manual entry form */

/** One control for the manual-entry form. `name` must equal the schema key: the
 *  submit handler posts raw FormData. */
function manualField(spec) {
  const label = spec.label + (spec.required ? ' *' : '');
  let input;

  if (spec.type === 'select') {
    // A spec with a form_default has no blank option — it's always set to something.
    const blank = spec.form_default ? [] : [el('option', { value: '', text: '' })];
    input = el('select', { name: spec.key }, [...blank,
      ...(spec.options || []).map((o) => el('option', {
        value: o, text: specLabel(spec, o), selected: o === spec.form_default,
      }))]);
  } else if (spec.type === 'checkbox') {
    input = el('input', { type: 'checkbox', name: spec.key, value: 'true' });
  } else if (spec.type === 'urls' || spec.type === 'textarea') {
    input = el('textarea', {
      name: spec.key, rows: spec.type === 'urls' ? 3 : 8, placeholder: spec.placeholder,
    });
  } else {
    input = el('input', {
      name: spec.key,
      type: NUMERIC_TYPES.includes(spec.type) ? 'number' : spec.type === 'date' ? 'date' : spec.type === 'url' ? 'url' : 'text',
      step: NUMERIC_TYPES.includes(spec.type) ? '1' : null,
      required: spec.required || null,
    });
  }
  return el('div', { class: 'field' }, el('label', { text: label }), input);
}

/** Build the manual-entry form from the schema. Called once, after boot's fetch —
 *  the fields never change, and rebuilding would wipe half-typed input. */
function renderManualFields() {
  // `reg` is rendered above the grid, with its Look up button.
  const specs = state.schema.fields.filter((f) => f.in_form && f.key !== 'reg');
  const grid = el('div', { class: 'grid2' });
  const wide = [];
  for (const spec of specs) {
    const node = manualField(spec);
    if (spec.type === 'urls' || spec.type === 'textarea') wide.push(node);
    else grid.append(node);
  }
  $('#manual-fields').replaceChildren(grid, ...wide);
}

function setupManualForm() {
  const form = $('#form-manual');
  const msg = $('#lookup-msg');

  $('#btn-lookup').addEventListener('click', async () => {
    const reg = form.reg.value.replace(/\s+/g, '').toUpperCase();
    msg.className = 'hint';
    if (!reg) { msg.textContent = 'Enter a number plate first'; return; }
    msg.textContent = 'Looking up…';
    try {
      const result = await post('/api/lookup/reg', { reg });
      // Only fill fields the user has left empty.
      for (const field of ['make', 'model', 'year', 'length_code', 'height_code']) {
        if (result[field] && form[field] && !form[field].value) form[field].value = result[field];
      }
      msg.className = 'hint ok';
      msg.textContent = [result.make, result.model, result.fuel_type]
        .filter(Boolean).join(' · ') || 'Found';
    } catch (err) {
      msg.className = 'hint error';
      msg.textContent = err.status === 404 ? 'No record found for this plate' : errorMessage(err);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    for (const key of Object.keys(data)) {
      if (data[key] === '') delete data[key];
    }
    if (data.image_urls) data.image_urls = data.image_urls.split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      const listing = await post('/api/listings', data);
      state.listings.unshift(listing);
      form.reset();
      msg.textContent = '';
      closeAllModals();
      render();
      openDrawer(listing.id);
      toast('Listing added');
    } catch (err) { toast(errorMessage(err), 'error'); }
  });
}

/* ------------------------------------------------------------ ebay import */

function setupImportForm() {
  const form = $('#form-import');
  const msg = $('#import-msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'hint';
    msg.textContent = 'Importing…';
    try {
      const listing = await post('/api/import/ebay', { url: form.url.value.trim() });
      state.listings.unshift(listing);
      form.reset();
      closeAllModals();
      render();
      openDrawer(listing.id);
      toast('Imported from eBay');
    } catch (err) {
      if (err.status === 409 && err.data && err.data.detail && err.data.detail.listing_id) {
        closeAllModals();
        openDrawer(err.data.detail.listing_id);
        toast('Already in the list — opened it');
        return;
      }
      msg.className = 'hint error';
      msg.textContent = errorMessage(err);
    }
  });
}

/* --------------------------------------------------------------- searches */

async function loadSearches() {
  state.searches = await get('/api/searches');
  renderSearches();
}

function renderSearches() {
  const body = $('#searches-body');
  body.replaceChildren(...state.searches.map((search) => {
    const save = async (field, value) => {
      try {
        const updated = await patch(`/api/searches/${search.id}`, { [field]: value });
        Object.assign(search, updated);
      } catch (err) { toast(errorMessage(err), 'error'); renderSearches(); }
    };
    return el('tr', {},
      el('td', {}, el('input', { value: search.label, onchange: (e) => save('label', e.target.value) })),
      el('td', {}, el('input', { value: search.query, onchange: (e) => save('query', e.target.value) })),
      el('td', {}, el('input', { type: 'number', value: search.max_price ?? '', onchange: (e) => save('max_price', e.target.value === '' ? null : Number(e.target.value)) })),
      el('td', {}, el('input', { type: 'checkbox', checked: search.enabled, onchange: (e) => save('enabled', e.target.checked) })),
      el('td', {}, el('button', {
        class: 'icon-btn', text: '🗑', title: 'Delete',
        onclick: async () => {
          if (!confirm(`Delete search "${search.label}"?`)) return;
          try {
            await del(`/api/searches/${search.id}`);
            state.searches = state.searches.filter((s) => s.id !== search.id);
            renderSearches();
          } catch (err) { toast(errorMessage(err), 'error'); }
        },
      })));
  }));
}

function setupSearchesForm() {
  $('#form-search-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form).entries());
    if (data.max_price === '') delete data.max_price;
    try {
      state.searches.push(await post('/api/searches', data));
      form.reset();
      renderSearches();
    } catch (err) { toast(errorMessage(err), 'error'); }
  });
}

/* --------------------------------------------------------------- columns */

async function loadProperties() {
  state.properties = await get('/api/properties');
  renderColumnsModal();
}

function renderColumnsModal() {
  const body = $('#columns-body');
  body.replaceChildren(...state.properties.map((prop, index) => el('tr', {},
    el('td', {}, el('input', {
      value: prop.label,
      onchange: async (e) => {
        try {
          Object.assign(prop, await patch(`/api/properties/${prop.id}`, { label: e.target.value }));
          render();
        } catch (err) { toast(errorMessage(err), 'error'); }
      },
    })),
    el('td', { text: prop.type }),
    el('td', { text: prop.options.join(', ') }),
    el('td', {},
      el('button', { class: 'icon-btn', text: '↑', disabled: index === 0, onclick: () => reorderProperty(index, -1) }),
      el('button', { class: 'icon-btn', text: '↓', disabled: index === state.properties.length - 1, onclick: () => reorderProperty(index, 1) })),
    el('td', {}, el('button', {
      class: 'icon-btn', text: '🗑', title: 'Delete',
      onclick: async () => {
        if (!confirm(`Delete column "${prop.label}"? Values on every listing will be removed.`)) return;
        try {
          await del(`/api/properties/${prop.id}`);
          await Promise.all([loadProperties(), loadListings()]);
          render();
          toast('Column deleted');
        } catch (err) { toast(errorMessage(err), 'error'); }
      },
    })))));
}

async function reorderProperty(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= state.properties.length) return;
  const reordered = [...state.properties];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  try {
    await Promise.all(reordered.map((p, i) => patch(`/api/properties/${p.id}`, { sort_order: i })));
    await loadProperties();
    render();
  } catch (err) { toast(errorMessage(err), 'error'); }
}

function setupColumnsForm() {
  $('#form-column-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form).entries());
    data.options = (data.options || '').split(',').map((s) => s.trim()).filter(Boolean);
    try {
      state.properties.push(await post('/api/properties', data));
      form.reset();
      renderColumnsModal();
      render();
      toast('Column added');
    } catch (err) { toast(errorMessage(err), 'error'); }
  });
}

/* ------------------------------------------------------------------ chips */

function renderChips() {
  const container = $('#status-chips');
  container.replaceChildren(...state.schema.statuses.map((status) => el('button', {
    class: 'chip' + (state.filters.statuses.has(status) ? ' on' : ''),
    text: statusLabel(status),
    onclick: () => {
      const set = state.filters.statuses;
      set.has(status) ? set.delete(status) : set.add(status);
      render();
    },
  })));
}

/* ------------------------------------------------------------------- boot */

function render() {
  renderChips();
  renderHeader();
  renderRows();
  if (state.selectedId) renderDrawer();
}

async function loadSchema() {
  // The field registry: table columns, drawer fields, form fields, status list.
  state.schema = await get('/api/schema');
}

async function loadListings() {
  // Fetch everything once; filtering and sorting happen client-side.
  state.listings = await get('/api/listings?active=-1');
}

function setupTopbar() {
  $('#btn-scrape').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Scraping…';
    try {
      const result = await post('/api/scrape');
      await loadListings();
      render();
      toast(`${result.new} new · ${result.updated} updated`);
      (result.errors || []).forEach((msg) => toast(msg, 'error'));
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Scrape eBay';
    }
  });

  const menu = $('#add-menu');
  $('#btn-add').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', () => menu.classList.add('hidden'));
  menu.addEventListener('click', (e) => {
    const which = e.target.dataset.add;
    if (!which) return;
    menu.classList.add('hidden');
    openModal(which === 'manual' ? '#modal-manual' : '#modal-import');
  });

  $('#btn-searches').addEventListener('click', async () => { await loadSearches(); openModal('#modal-searches'); });
  $('#btn-columns').addEventListener('click', () => { renderColumnsModal(); openModal('#modal-columns'); });

  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);

  // A refresh while mid-sentence used to lose the note still sitting on the
  // 800ms debounce; flush it (keepalive, so the request survives the unload).
  window.addEventListener('beforeunload', () => { unloading = true; flushNotes(); });
}

function setupFilters() {
  $('#filter-source').addEventListener('change', (e) => { state.filters.source = e.target.value; render(); });
  $('#filter-q').addEventListener('input', debounce((e) => { state.filters.q = e.target.value; render(); }, 150));
  $('#filter-max-price').addEventListener('input', debounce((e) => {
    state.filters.maxPrice = e.target.value === '' ? null : Number(e.target.value);
    render();
  }, 150));
  $('#filter-inactive').addEventListener('change', (e) => { state.filters.showInactive = e.target.checked; render(); });
}

async function boot() {
  setupTopbar();
  setupFilters();
  setupModals();
  setupManualForm();
  setupImportForm();
  setupSearchesForm();
  setupColumnsForm();
  try {
    await Promise.all([loadSchema(), loadListings(), loadProperties()]);
  } catch (err) {
    toast('Could not load data: ' + errorMessage(err), 'error');
  }
  renderManualFields();
  render();
}

boot();
