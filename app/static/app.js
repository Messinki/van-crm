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
    // `detail` is usually a string, but a few endpoints send an object so the
    // caller can act on it (the import 409 carries the existing listing's id).
    const detail = data && data.detail;
    const message = (detail && typeof detail === 'object' ? detail.message : detail) || res.statusText;
    const err = new Error(message);
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

function isoInDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

function todayIso() {
  return isoInDays(0);
}

/** An ISO-8601 UTC stamp (db.now_iso()) as local date + time. */
function formatStamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
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

// Amendment 01 §A column order, now owned by the backend registry. A field gets a
// column unless it sets in_table: false. The table is read-only: the only clickable
// thing in a row is the title link (opens the original listing); everything else
// opens the drawer, where editing happens. Custom properties are appended after the
// registry's columns, in their own order.
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
  // The MOT cell is an object; what you want to sort it by is the expiry date.
  if (key === 'mot') return (listing.mot && listing.mot.expiry) || null;
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

    case 'badge': {
      // Source is free text now (suggest-only), so only the values we know about
      // get a dedicated colour and a shortened label — anything else shows as-is.
      const known = value === 'ebay' || value === 'facebook' || value === 'manual';
      return el('td', {}, el('span', {
        class: 'badge' + (known ? ' ' + value : ''),
        text: value === 'ebay' ? 'eBay' : value === 'facebook' ? 'FB' : value === 'manual' ? 'Manual' : value,
      }));
    }

    case 'status_pill':
      return el('td', {}, el('span', {
        class: 'status-pill st-' + value,
        text: statusLabel(value),
      }));

    case 'mot':
      return motCell(listing);

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

/* -------------------------------------------------------------------- MOT */

// Derived MOT reports (the drawer's panel) keyed by listing id, kept for the
// session so reopening a drawer doesn't re-request. The compact summary the
// table needs already rides on every listing as `listing.mot`.
const motDetails = new Map();

/** MOT column: no reg → a hint, no cached check → a Check button, else expiry + badges. */
function motCell(listing) {
  if (!listing.reg) return el('td', { class: 'mot-cell muted', text: 'add reg' });

  const summary = listing.mot;
  const td = el('td', { class: 'mot-cell' });
  if (!summary) {
    td.append(motCheckButton(listing));
    return td;
  }

  if (summary.expiry) {
    const expired = summary.expiry < todayIso();
    td.append(el('span', {
      class: 'mot-expiry' + (summary.expiry <= isoInDays(30) ? ' overdue' : ''),
      text: formatDate(summary.expiry),
      title: (expired ? 'MOT expired ' : 'MOT expires ') + formatDate(summary.expiry)
        + ' · checked ' + formatStamp(summary.fetched_at),
    }));
  } else {
    td.append(el('span', {
      class: 'mot-expiry overdue', text: 'no pass',
      title: 'No passing test on record — the latest test is a fail',
    }));
  }
  td.append(...motBadges(summary));
  return td;
}

/** Quiet badges: dangerous / major defect counts, then one catch-all warning. */
function motBadges(summary) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} in the last 3 years`;
  const badges = [];
  if (summary.dangerous) {
    badges.push(el('span', {
      class: 'mot-badge danger', text: 'D' + summary.dangerous,
      title: plural(summary.dangerous, 'dangerous defect'),
    }));
  }
  if (summary.major) {
    badges.push(el('span', {
      class: 'mot-badge major', text: 'M' + summary.major,
      title: plural(summary.major, 'major defect'),
    }));
  }
  const warnings = [];
  if (summary.mileage_warning) warnings.push('the mileage goes backwards in this history');
  if (summary.flagged) warnings.push('corrosion, rust, an oil leak or "excessively" in a recent defect');
  if (warnings.length) {
    badges.push(el('span', { class: 'mot-badge warn', text: '⚠', title: 'Worth a look: ' + warnings.join('; ') }));
  }
  return badges;
}

/** In-cell Check button — stops the click opening the drawer, like the title link. */
function motCheckButton(listing) {
  const btn = el('button', {
    class: 'mini-btn', text: 'Check', title: 'Fetch the MOT history for ' + formatReg(listing.reg),
    onclick: async (event) => {
      event.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        const result = await post(`/api/listings/${listing.id}/mot`);
        listing.mot = result.summary;
        motDetails.set(listing.id, result.derived);
        renderRows();
        if (state.selectedId === listing.id) renderDrawer();
      } catch (err) {
        toast(errorMessage(err), 'error');
        btn.disabled = false;
        btn.textContent = 'Check';
      }
    },
  });
  return btn;
}

/** Drawer MOT panel: the Check/Refresh button and the report it produces. */
function motPanel(listing) {
  const body = el('div', { class: 'mot-report' });
  const msg = el('p', { class: 'hint' });
  const button = el('button', {
    class: 'btn', text: listing.reg ? 'Check MOT' : 'Add a reg first', disabled: !listing.reg,
  });

  const show = (derived, fetchedAt) => {
    motDetails.set(listing.id, derived);
    body.replaceChildren(...motReport(derived));
    button.textContent = 'Refresh';
    msg.className = 'hint';
    msg.textContent = fetchedAt ? 'Checked ' + formatStamp(fetchedAt) : '';
  };

  button.addEventListener('click', async () => {
    // Anything already on screen came from the cache, so the button is a Refresh.
    const force = motDetails.has(listing.id) || Boolean(listing.mot);
    button.disabled = true;
    button.textContent = force ? 'Refreshing…' : 'Checking…';
    msg.className = 'hint';
    msg.textContent = '';
    try {
      const result = await post(`/api/listings/${listing.id}/mot?force=${force}`);
      listing.mot = result.summary;
      show(result.derived, result.fetched_at);
      renderRows();
    } catch (err) {
      msg.className = 'hint error';
      msg.textContent = errorMessage(err);
      button.textContent = force ? 'Refresh' : 'Check MOT';
    } finally {
      button.disabled = false;
    }
  });

  const loaded = motDetails.get(listing.id);
  if (loaded) {
    show(loaded, listing.mot && listing.mot.fetched_at);
  } else if (listing.mot) {
    // Cached on the server but not pulled into this page yet: fetch the full
    // report quietly, without spending a DVSA call.
    get(`/api/listings/${listing.id}/mot`)
      .then((result) => {
        if (result.cached && state.selectedId === listing.id) show(result.derived, result.fetched_at);
      })
      .catch(() => { /* the button is still there to try again */ });
  }

  return el('div', { class: 'field mot-panel' }, el('div', { class: 'row' }, button), msg, body);
}

/** The derived MOT history as drawer nodes (spec §8.3). */
function motReport(derived) {
  const parts = [];
  const vehicle = [
    derived.make, derived.model, derived.fuel_type, derived.colour,
    derived.first_used_date ? 'first used ' + derived.first_used_date.slice(0, 4) : null,
  ].filter(Boolean).join(' · ');
  if (vehicle) parts.push(el('p', { class: 'mot-vehicle', text: vehicle }));

  const expiry = derived.latest_expiry;
  parts.push(el('p', { class: 'mot-latest' },
    el('strong', {
      class: derived.latest_result === 'PASSED' ? 'ok' : 'bad',
      text: derived.latest_result || 'no tests on record',
    }),
    derived.latest_test_date ? ' on ' + formatDate(derived.latest_test_date) : null,
    expiry ? ' · expires ' : null,
    expiry ? el('span', { class: expiry <= isoInDays(30) ? 'overdue' : null, text: formatDate(expiry) }) : null));

  const { dangerous, major, fails } = derived.serious;
  if (dangerous || major || fails) {
    const counts = [
      fails ? `${fails} fail${fails === 1 ? '' : 's'}` : null,
      dangerous ? `${dangerous} dangerous` : null,
      major ? `${major} major` : null,
    ].filter(Boolean).join(' · ');
    parts.push(el('p', {
      class: 'mot-serious',
      text: `Last 3 years: ${counts}`,
      title: 'A fail that was fixed on a retest still counts — it is history, not a verdict',
    }));
  }

  if (derived.keyword_flags.length) {
    parts.push(el('ul', { class: 'flag-list' },
      derived.keyword_flags.map((text) => el('li', { text }))));
  }

  if (derived.mileage_series.length) {
    if (derived.mileage_warning) {
      parts.push(el('p', { class: 'mot-warn', text: 'Mileage goes backwards in this history — possible clocking.' }));
    }
    parts.push(el('ul', { class: 'mileage-list' },
      [...derived.mileage_series].reverse().map((point) =>
        el('li', { text: `${formatDate(point.date)} — ${number(point.miles)} mi` }))));
  }

  if (derived.tests.length) {
    parts.push(el('details', { class: 'mot-tests' },
      el('summary', { text: `All ${derived.tests.length} test${derived.tests.length === 1 ? '' : 's'}` }),
      derived.tests.map(motTestBlock)));
  }
  return parts;
}

// Severity order, so a test's defects read worst-first however DVSA listed them.
const DEFECT_ORDER = ['DANGEROUS', 'MAJOR', 'MINOR', 'ADVISORY'];

function motTestBlock(test) {
  const head = el('div', { class: 'mot-test-head' },
    el('span', { text: formatDate(test.date) }),
    el('span', { class: test.result === 'PASSED' ? 'ok' : 'bad', text: test.result || '' }),
    el('span', { class: 'muted', text: test.odometer_miles === null ? '' : number(test.odometer_miles) + ' mi' }));

  const sorted = [...test.defects].sort(
    (a, b) => DEFECT_ORDER.indexOf(a.level) - DEFECT_ORDER.indexOf(b.level));
  const defects = sorted.length
    ? el('ul', { class: 'defect-list' }, sorted.map((defect) =>
        el('li', { class: 'defect ' + defect.level.toLowerCase(), text: defect.text })))
    : el('p', { class: 'muted no-defects', text: 'No defects recorded' });

  return el('div', { class: 'mot-test' }, head, defects);
}

/* ------------------------------------------------------------------- save */

async function saveField(listing, field, value) {
  const updated = await patch(`/api/listings/${listing.id}`, { [field]: value });
  Object.assign(listing, updated);
  return updated;
}

/* ----------------------------------------------- shared field-input helpers */

const NUMERIC_TYPES = ['number', 'integer', 'money'];

// A spec with `suggest` gets a <datalist> of the values already used across the
// listings, so make/model/year autocomplete from what's been entered before while
// staying free text. state.listings holds every listing (boot fetches active=-1),
// so the values come from memory — no endpoint of its own.
const suggestId = (key) => 'suggest-' + key;

/** Rebuild every suggestion list from the current listings. Cheap, and cheaper
 *  than tracking which save invalidated what — call it before showing a surface
 *  that has suggest inputs. */
function refreshSuggestions() {
  const specs = state.schema.fields.filter((f) => f.suggest);
  $('#suggestions').replaceChildren(...specs.map((spec) => {
    const seen = new Set();
    for (const listing of state.listings) {
      const value = listing[spec.key];
      if (value === null || value === undefined || value === '') continue;
      seen.add(String(value));
    }
    // Years read best newest-first; everything else alphabetically.
    const values = Array.from(seen).sort(NUMERIC_TYPES.includes(spec.type)
      ? (a, b) => Number(b) - Number(a)
      : (a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' }));
    return el('datalist', { id: suggestId(spec.key) },
      values.map((v) => el('option', { value: v })));
  }));
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
    // Same rule as the manual form: a spec with a form_default is never blank,
    // so don't offer a blank the API would reject.
    const blank = spec.form_default ? [] : [el('option', { value: '', text: '' })];
    input = el('select', { onchange: (e) => save(e.target.value === '' ? null : e.target.value) },
      [...blank,
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
      list: spec.suggest ? suggestId(key) : null,
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
  if (lastLookup.has(listing.id)) showLookupResult(lookupMsg, lastLookup.get(listing.id));
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

/** A field the API won't let anyone change: shown in the drawer, but not editable. */
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

/** The specs rendered under a section heading, in registry order.
 *  A field is in the drawer unless it opts out, and lands in Details unless it
 *  names a section — same defaults the backend registry documents. */
function sectionFields(name) {
  return state.schema.fields.filter((f) =>
    f.in_drawer !== false && (f.section || 'Details') === name);
}

function renderDrawer() {
  const listing = state.listings.find((l) => l.id === state.selectedId);
  if (!listing) return closeDrawer();

  refreshSuggestions();
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

  // The DVSA report hangs off the end of the MOT section.
  parts.push(motPanel(listing));

  const actions = el('div', { class: 'drawer-actions' });
  if (listing.source === 'ebay') {
    const liveBtn = el('button', {
      class: 'btn', text: 'Check listing live',
      onclick: async () => {
        liveBtn.disabled = true;
        liveBtn.textContent = 'Checking…';
        try {
          // The row's price and active flag can both move, so re-render from the
          // listing the check hands back rather than guessing what changed.
          const result = await post(`/api/listings/${listing.id}/check`);
          Object.assign(listing, result.listing);
          renderDrawer();
          renderRows();
          toast(result.message, result.active ? '' : 'error');
        } catch (err) {
          toast(errorMessage(err), 'error');
          liveBtn.disabled = false;
          liveBtn.textContent = 'Check listing live';
        }
      },
    });
    actions.append(liveBtn);
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

// What a plate lookup is allowed to fill in — and only where the field is empty,
// so the user's own typing always stands. Fuel, colour and engine size aren't
// listing fields; they're shown as an informational line instead.
const LOOKUP_FILLS = ['make', 'model', 'year', 'length_code', 'height_code', 'mileage', 'mot_due'];

// The last successful lookup per listing, so its detail line survives the drawer
// re-render that follows the PATCH.
const lastLookup = new Map();

function lookupDetailLine(result) {
  return [result.fuel_type, result.colour, result.engine_size ? result.engine_size + 'cc' : null]
    .filter(Boolean).join(' · ');
}

/** Two lines under the reg field: what it is, then the read-only extras. */
function showLookupResult(msgNode, result) {
  const headline = [result.make, result.model, result.year].filter(Boolean).join(' ') || 'Found';
  const detail = lookupDetailLine(result);
  msgNode.className = 'hint ok';
  msgNode.replaceChildren(...[
    el('span', { class: 'lookup-line', text: headline }),
    detail ? el('span', { class: 'lookup-line muted', text: detail }) : null,
    // A lookup can half-succeed. Say so, rather than letting the missing half
    // pass for a plate that simply has no tax record.
    ...(result.warnings || []).map((text) =>
      el('span', { class: 'lookup-line lookup-warn', text })),
  ].filter(Boolean));
}

function showLookupError(msgNode, err) {
  msgNode.className = 'hint error';
  msgNode.textContent = err.status === 404
    ? (errorMessage(err) || 'No record found for this plate')
    : errorMessage(err);
}

async function lookupPlate(reg, msgNode, listing) {
  const cleaned = (reg || '').replace(/\s+/g, '').toUpperCase();
  msgNode.className = 'hint';
  if (!cleaned) { msgNode.textContent = 'Enter a number plate first'; return; }
  msgNode.textContent = 'Looking up…';
  try {
    const result = await post('/api/lookup/reg', { reg: cleaned });
    const fill = {};
    for (const field of LOOKUP_FILLS) {
      if (result[field] && listing && !listing[field]) fill[field] = result[field];
    }
    if (listing) {
      fill.reg = cleaned;
      // The lookup warmed mot_cache, so this response carries the MOT summary too.
      const updated = await patch(`/api/listings/${listing.id}`, fill);
      Object.assign(listing, updated);
      // renderDrawer() replaces msgNode with a fresh one, so the result is kept
      // here for drawerRegField() to put back.
      lastLookup.set(listing.id, result);
      renderDrawer();
      renderRows();
      return result;
    }
    showLookupResult(msgNode, result);
    return result;
  } catch (err) {
    showLookupError(msgNode, err);
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
      list: spec.suggest ? suggestId(spec.key) : null,
      step: NUMERIC_TYPES.includes(spec.type) ? '1' : null,
      required: spec.required || null,
      value: spec.form_default || null,
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
      // Only fill fields the user has left empty; everything stays editable.
      for (const field of LOOKUP_FILLS) {
        if (result[field] && form[field] && !form[field].value) form[field].value = result[field];
      }
      showLookupResult(msg, result);
    } catch (err) {
      showLookupError(msg, err);
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
      msg.className = 'hint';
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
      msg.textContent = '';
      closeAllModals();
      render();
      openDrawer(listing.id);
      toast('Imported from eBay');
      // Amendment §E step 5: the importer reads a plate out of the title and
      // description when there's exactly one, and the drawer is already open on
      // the row — so point at the Look up button rather than pressing it.
      if (listing.reg) toast(`Reg found: ${formatReg(listing.reg)} — Look up plate to fill the rest`);
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
    const numberCell = (field) => el('td', {}, el('input', {
      type: 'number', class: 'narrow-input', value: search[field] ?? '',
      onchange: (e) => save(field, e.target.value === '' ? null : Number(e.target.value)),
    }));
    return el('tr', {},
      el('td', {}, el('input', { value: search.label, onchange: (e) => save('label', e.target.value) })),
      el('td', {}, el('input', { value: search.query, onchange: (e) => save('query', e.target.value) })),
      numberCell('max_price'),
      numberCell('year_min'),
      numberCell('year_max'),
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
    for (const field of ['max_price', 'year_min', 'year_max']) {
      if (data[field] === '') delete data[field];
    }
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
    // The manual form is built once at boot, so its suggestion lists need
    // topping up with anything added since.
    if (which === 'manual') refreshSuggestions();
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
