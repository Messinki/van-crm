'use strict';

/* ------------------------------------------------------------------ state */

const STATUSES = ['new', 'considering', 'contacted', 'viewing_booked', 'rejected', 'purchased'];
const STATUS_LABELS = {
  new: 'New', considering: 'Considering', contacted: 'Contacted',
  viewing_booked: 'Viewing booked', rejected: 'Rejected', purchased: 'Purchased',
};
const LENGTH_CODES = ['L1', 'L2', 'L3', 'L4'];
const HEIGHT_CODES = ['H1', 'H2', 'H3'];

const state = {
  listings: [],
  properties: [],
  searches: [],
  filters: { statuses: new Set(), source: '', q: '', maxPrice: null, showInactive: false },
  sort: { key: 'id', dir: 'desc' },
  selectedId: null,
};

/* -------------------------------------------------------------------- api */

async function api(method, path, body) {
  const opts = { method, headers: {} };
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

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function errorMessage(err) {
  return err && err.message ? err.message : 'Something went wrong';
}

/* ---------------------------------------------------------------- columns */

// Amendment 01 §A column order. `edit` marks a cell as inline-editable.
const BASE_COLUMNS = [
  { key: 'thumb', label: '', sortable: false },
  { key: 'title', label: 'Title', edit: 'text' },
  { key: 'price_gbp', label: 'Price', edit: 'number', numeric: true },
  { key: 'make', label: 'Make', edit: 'text' },
  { key: 'model', label: 'Model', edit: 'text' },
  { key: 'year', label: 'Year', edit: 'number', numeric: true },
  { key: 'mileage', label: 'Mileage', edit: 'number', numeric: true },
  { key: 'height_code', label: 'Height', edit: 'code' },
  { key: 'length_code', label: 'Length', edit: 'code' },
  { key: 'euro_status', label: 'Euro', edit: 'text' },
  { key: 'reg', label: 'Reg', edit: 'text' },
  { key: 'location', label: 'Location', edit: 'text' },
  { key: 'source', label: 'Source' },
  { key: 'status', label: 'Status' },
  { key: 'mot', label: 'MOT', sortable: false },
];

function columns() {
  const custom = state.properties.map((p) => ({
    key: 'custom:' + p.key, label: p.label, property: p, numeric: p.type === 'number',
  }));
  return [...BASE_COLUMNS, ...custom, { key: 'notes', label: 'Notes', sortable: false }];
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
      if (event.target.closest('td.no-drawer, input, select, button, a')) return;
      openDrawer(listing.id);
    },
  });
  tr.append(...columns().map((col) => renderCell(listing, col)));
  return tr;
}

function renderCell(listing, col) {
  const { key } = col;

  if (key === 'thumb') {
    // Deliberately not `no-drawer`: almost every other cell is click-to-edit, so the
    // thumbnail is the reliable place to click for the detail drawer.
    const src = listing.image_urls[0];
    return el('td', { class: 'open-cell', title: 'Open details' },
      src ? el('img', { class: 'thumb', src, loading: 'lazy', alt: '' }) : el('div', { class: 'thumb-empty' }));
  }

  if (key === 'title') {
    const td = el('td', { class: 'title-cell editable no-drawer' });
    td.append(listing.url
      ? el('a', { href: listing.url, target: '_blank', rel: 'noopener', text: listing.title })
      : document.createTextNode(listing.title));
    td.addEventListener('dblclick', () => startEdit(td, listing, 'title', 'text'));
    td.title = 'Double-click to rename';
    return td;
  }

  if (key === 'source') {
    return el('td', {}, el('span', { class: 'badge ' + listing.source, text: listing.source === 'ebay' ? 'eBay' : listing.source === 'facebook' ? 'FB' : 'Manual' }));
  }

  if (key === 'status') {
    const select = el('select', {
      class: 'status-pill st-' + listing.status,
      onchange: async (e) => {
        try {
          await saveField(listing, 'status', e.target.value);
        } catch (err) { toast(errorMessage(err), 'error'); }
        render();
      },
    }, STATUSES.map((s) => el('option', { value: s, text: STATUS_LABELS[s], selected: s === listing.status })));
    return el('td', { class: 'no-drawer' }, select);
  }

  if (key === 'mot') {
    return el('td', { class: 'no-drawer' }, motCell(listing));
  }

  if (key === 'notes') {
    const preview = (listing.notes || '').replace(/\s+/g, ' ').trim();
    return el('td', { class: 'notes-cell', text: preview.length > 60 ? preview.slice(0, 60) + '…' : preview });
  }

  if (col.edit === 'code') {
    const codes = key === 'height_code' ? HEIGHT_CODES : LENGTH_CODES;
    const select = el('select', {
      class: 'code-select',
      onchange: async (e) => {
        try { await saveField(listing, key, e.target.value || null); } catch (err) { toast(errorMessage(err), 'error'); }
      },
    }, [el('option', { value: '', text: '—' }), ...codes.map((c) => el('option', { value: c, text: c, selected: listing[key] === c }))]);
    return el('td', { class: 'no-drawer' }, select);
  }

  if (key.startsWith('custom:')) {
    return customCell(listing, col);
  }

  // Plain inline-editable cells.
  const value = listing[key];
  const display = key === 'price_gbp' ? money(value)
    : key === 'mileage' ? number(value)
    : key === 'reg' ? formatReg(value)
    : (value === null || value === undefined ? '' : String(value));
  const td = el('td', {
    class: 'editable no-drawer' + (col.numeric ? ' num' : ''),
    text: display,
    onclick: () => startEdit(td, listing, key, col.edit),
  });
  return td;
}

function motCell(listing) {
  if (!listing.reg) return el('span', { class: 'muted', text: 'add reg' });
  return el('button', {
    class: 'btn',
    text: 'Check',
    onclick: async (e) => {
      e.stopPropagation();
      try {
        await post(`/api/listings/${listing.id}/mot`);
      } catch (err) { toast(errorMessage(err), 'error'); }
    },
  });
}

function customCell(listing, col) {
  const prop = col.property;
  const value = listing.custom[prop.key];
  const save = async (raw) => {
    try {
      const updated = await patch(`/api/listings/${listing.id}`, { custom: { [prop.key]: raw } });
      Object.assign(listing, updated);
    } catch (err) {
      toast(errorMessage(err), 'error');
      render();
    }
  };

  if (prop.type === 'checkbox') {
    return el('td', { class: 'no-drawer' }, el('input', {
      type: 'checkbox', checked: value === true, onchange: (e) => save(e.target.checked),
    }));
  }
  if (prop.type === 'select') {
    return el('td', { class: 'no-drawer' }, el('select', {
      class: 'code-select', onchange: (e) => save(e.target.value || null),
    }, [el('option', { value: '', text: '—' }),
        ...prop.options.map((o) => el('option', { value: o, text: o, selected: value === o }))]));
  }
  if (prop.type === 'date') {
    return el('td', { class: 'no-drawer' }, el('input', {
      type: 'date', class: 'cell-input', value: value || '', onchange: (e) => save(e.target.value || null),
    }));
  }

  const td = el('td', {
    class: 'editable no-drawer' + (prop.type === 'number' ? ' num' : ''),
    text: value === undefined || value === null ? '' : String(value),
    onclick: () => startCustomEdit(td, listing, prop),
  });
  return td;
}

/* ------------------------------------------------------------ inline edit */

function startEdit(td, listing, field, kind) {
  if (td.querySelector('input')) return;
  const original = listing[field];
  const input = el('input', {
    class: 'cell-input',
    type: kind === 'number' ? 'number' : 'text',
    value: original === null || original === undefined ? '' : original,
  });
  td.replaceChildren(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const raw = input.value.trim();
      const next = raw === '' ? null : (kind === 'number' ? Number(raw) : raw);
      if (next !== original) {
        try { await saveField(listing, field, next); } catch (err) { toast(errorMessage(err), 'error'); }
      }
    }
    render();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function startCustomEdit(td, listing, prop) {
  if (td.querySelector('input')) return;
  const original = listing.custom[prop.key];
  const input = el('input', {
    class: 'cell-input',
    type: prop.type === 'number' ? 'number' : 'text',
    value: original === undefined || original === null ? '' : original,
  });
  td.replaceChildren(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const raw = input.value.trim();
      try {
        const updated = await patch(`/api/listings/${listing.id}`, { custom: { [prop.key]: raw === '' ? null : raw } });
        Object.assign(listing, updated);
      } catch (err) { toast(errorMessage(err), 'error'); }
    }
    render();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

async function saveField(listing, field, value) {
  const updated = await patch(`/api/listings/${listing.id}`, { [field]: value });
  Object.assign(listing, updated);
  return updated;
}

/* ----------------------------------------------------------------- drawer */

function openDrawer(id) {
  state.selectedId = id;
  $('#drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
  renderDrawer();
  renderRows();
}

function closeDrawer() {
  state.selectedId = null;
  $('#drawer').classList.add('hidden');
  $('#drawer-backdrop').classList.add('hidden');
  renderRows();
}

function drawerField(listing, label, field, type, options) {
  const onchange = async (e) => {
    const raw = e.target.value;
    const value = raw === '' ? null : (type === 'number' ? Number(raw) : raw);
    try {
      await saveField(listing, field, value);
      renderRows();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  const input = options
    ? el('select', { onchange }, [el('option', { value: '', text: '' }),
        ...options.map((o) => el('option', { value: o.value ?? o, text: o.label ?? o, selected: (o.value ?? o) === listing[field] }))])
    : el('input', { type: type === 'number' ? 'number' : 'text', value: listing[field] ?? '', onchange });
  return el('div', { class: 'field' }, el('label', { text: label }), input);
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

  parts.push(el('div', { class: 'section-title', text: 'Details' }));
  parts.push(drawerField(listing, 'Title', 'title', 'text'));
  parts.push(drawerField(listing, 'Link (URL)', 'url', 'text'));
  parts.push(drawerField(listing, 'Price (£)', 'price_gbp', 'number'));
  parts.push(drawerField(listing, 'Make', 'make', 'text'));
  parts.push(drawerField(listing, 'Model', 'model', 'text'));
  parts.push(drawerField(listing, 'Year', 'year', 'number'));
  parts.push(drawerField(listing, 'Mileage', 'mileage', 'number'));
  parts.push(drawerField(listing, 'Length', 'length_code', 'text', LENGTH_CODES));
  parts.push(drawerField(listing, 'Height', 'height_code', 'text', HEIGHT_CODES));
  parts.push(drawerField(listing, 'Euro status', 'euro_status', 'text'));
  parts.push(drawerField(listing, 'Location', 'location', 'text'));
  parts.push(drawerField(listing, 'Seller', 'seller_name', 'text'));
  parts.push(drawerField(listing, 'Status', 'status', 'text',
    STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))));

  // Reg + plate lookup (the lookup endpoint activates once DVSA/DVLA keys exist).
  const regInput = el('input', {
    value: formatReg(listing.reg), onchange: async (e) => {
      try { await saveField(listing, 'reg', e.target.value || null); renderDrawer(); renderRows(); }
      catch (err) { toast(errorMessage(err), 'error'); }
    },
  });
  const lookupMsg = el('p', { class: 'hint' });
  parts.push(el('div', { class: 'field' },
    el('label', { text: 'Number plate' }),
    el('div', { class: 'row' }, regInput, el('button', {
      class: 'btn', text: 'Look up plate', onclick: () => lookupPlate(regInput.value, lookupMsg, listing),
    })),
    lookupMsg));

  if (state.properties.length) {
    parts.push(el('div', { class: 'section-title', text: 'Custom' }));
    for (const prop of state.properties) {
      parts.push(drawerCustomField(listing, prop));
    }
  }

  parts.push(el('div', { class: 'section-title', text: 'Notes' }));
  const savedHint = el('div', { class: 'save-hint' });
  const notes = el('textarea', { rows: 6 });
  notes.value = listing.notes || '';
  const autosave = debounce(async () => {
    try {
      await saveField(listing, 'notes', notes.value);
      savedHint.textContent = 'Saved';
      setTimeout(() => { savedHint.textContent = ''; }, 1500);
      renderRows();
    } catch (err) { toast(errorMessage(err), 'error'); }
  }, 800);
  notes.addEventListener('input', () => { savedHint.textContent = 'Saving…'; autosave(); });
  parts.push(el('div', { class: 'field' }, notes, savedHint));

  if (listing.description) {
    parts.push(el('div', { class: 'section-title', text: 'Description' }));
    parts.push(el('div', { class: 'readonly-block', text: listing.description }));
  }

  parts.push(el('div', { class: 'section-title', text: 'MOT' }));
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
    for (const field of ['make', 'model', 'year', 'euro_status', 'length_code', 'height_code']) {
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
      for (const field of ['make', 'model', 'year', 'euro_status', 'length_code', 'height_code']) {
        if (result[field] && form[field] && !form[field].value) form[field].value = result[field];
      }
      msg.className = 'hint ok';
      msg.textContent = [result.make, result.model, result.fuel_type, result.euro_status]
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
  container.replaceChildren(...STATUSES.map((status) => el('button', {
    class: 'chip' + (state.filters.statuses.has(status) ? ' on' : ''),
    text: STATUS_LABELS[status],
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
    await Promise.all([loadListings(), loadProperties()]);
  } catch (err) {
    toast('Could not load data: ' + errorMessage(err), 'error');
  }
  render();
}

boot();
