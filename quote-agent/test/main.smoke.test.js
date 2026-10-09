// Runs the Apps Script bundle in a sandbox with fake Google services and a
// fake Claude API, to catch wiring mistakes that only show up at run time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fixture = require('./fixtures/catalog.json');

// Always test the bundle that gets pasted into Apps Script.
require('child_process').execSync('node build.js', { cwd: path.join(__dirname, '..') });

function fakeText(initial) {
  let s = initial;
  return {
    asString: () => s,
    setText: (v) => { s = v; },
    replaceAllText: (a, b) => { s = s.split(a).join(b); },
  };
}

function fakeTable(rows) {
  const table = {
    rows: rows.map((cells) => ({ cells: cells.map(fakeText) })),
    getNumRows: () => table.rows.length,
    getRow: (i) => {
      const r = table.rows[i];
      return {
        getNumCells: () => r.cells.length,
        getCell: (c) => ({ getText: () => r.cells[c] }),
        remove: () => table.rows.splice(table.rows.indexOf(r), 1),
      };
    },
    insertRow: (i) => { table.rows.splice(i + 1, 0, { cells: ['', '', '', ''].map(fakeText) }); },
  };
  return table;
}

function buildSandbox(claudeReplies, opts = {}) {
  const appended = { Quotes: [], Log: [] };
  const investmentRows = [['Item', 'Qty', 'Unit', 'Total']]
    .concat(Array.from({ length: 12 }, () => ['', '', '', '']))
    .concat([['Subtotal', '', '', '{{SUBTOTAL}}'], ['IVA', '', '', '{{VAT}}'], ['Total', '', '', '{{TOTAL}}']]);
  const slides = [];
  const mkSlide = (notes, table) => {
    const slide = {
      notes, table, removed: false,
      getNotesPage: () => ({ getSpeakerNotesShape: () => ({ getText: () => fakeText(notes) }) }),
      getTables: () => (slide.table ? [slide.table] : []),
      replaceAllText: () => {},
      duplicate: () => { const d = mkSlide(notes, fakeTable(investmentRows)); slides.push(d); return d; },
      remove: () => { slide.removed = true; },
    };
    return slide;
  };
  slides.push(mkSlide('#samples automotive', null), mkSlide('#samples corporate', null), mkSlide('#investment', fakeTable(investmentRows)));

  const sheet = (name) => ({
    appendRow: (r) => appended[name].push(r),
    getLastRow: () => appended[name].length + 1,
    getRange: () => ({ insertCheckboxes: () => {}, getValues: () => [], getDisplayValues: () => fixture.rows, getDisplayValue: () => '4,000' }),
  });
  const replies = claudeReplies.slice();
  const props = { ANTHROPIC_API_KEY: 'test', RATE_SHEET_ID: 'r', TEMPLATE_ID_EN: 't', TRACKER_ID: 'k', DECKS_FOLDER_ID: 'f' };
  const sandbox = {
    console,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => props[k] || null,
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: (k) => { delete props[k]; },
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'pablo@example.com' }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => sheet(n === 'Quotes' || n === 'Log' ? n : 'Quotes') }) },
    UrlFetchApp: { fetch: () => (opts.apiDown
      ? { getResponseCode: () => 529, getContentText: () => 'overloaded' }
      : { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(replies.shift()) }] }) }) },
    Utilities: { sleep: () => {}, formatDate: () => '2026-10-09' },
    DriveApp: { getFileById: () => ({ makeCopy: () => ({ getId: () => 'deck1', getUrl: () => 'https://docs.google.com/deck1' }) }), getFolderById: () => ({}) },
    SlidesApp: { openById: () => ({ replaceAllText: () => {}, getSlides: () => slides.filter((s) => !s.removed), saveAndClose: () => {} }) },
    GmailApp: {
      getUserLabelByName: () => ({}),
      getAliases: () => ['info@intelygente.net'],
      search: (q, start) => (start === 0 && opts.threads ? opts.threads : []),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dist', 'QuoteAgent.gs'), 'utf8'), sandbox);
  return { sandbox, appended, slides, props };
}

const fakeMessage = {
  getFrom: () => 'Client <client@example.com>', getTo: () => 'info@intelygente.net', getCc: () => '',
  getHeader: () => '', getAttachments: () => [], getPlainBody: () => 'We need a 3 day shoot', getDate: () => new Date('2026-10-01'), getId: () => 'm1',
};
const fakeThread = { getFirstMessageSubject: () => 'Quote request', getPermalink: () => 'https://mail/1', getId: () => 't1', addLabel: () => {}, getMessages: () => [fakeMessage] };

test('quotable email produces a deck with two investment slides and a tracker row', () => {
  const extraction = {
    client: { contact_name: 'Ana', company: 'Example Motors', country: 'China' },
    project_title: 'Test drive video', summary: 'Three day automotive shoot.',
    options: [
      { name: 'Filming only', lines: [{ item_id: 'R10', quantity: 3, label: '2-camera shoot', note: '' }] },
      { name: 'Filming + post', lines: [{ item_id: 'R10', quantity: 3, label: '2-camera shoot', note: '' }, { item_id: 'R12', quantity: 10, label: 'Editing', note: '' }] },
    ],
    unpriced: [], missing_info: ['Exact dates'], deliverables: '10 min video', intro: 'Hi', selling_points: ['A', 'B', 'C'], sample_categories: ['automotive'],
  };
  const { sandbox, appended, slides } = buildSandbox([{ type: 'quotable', language: 'en', reason: 'clear' }, extraction]);
  sandbox.loadCatalog_();
  vm.runInContext('processMessage_(t, [m], loadCatalog_(), SpreadsheetApp.openById("k"))', Object.assign(sandbox, { t: fakeThread, m: fakeMessage }));

  const row = appended.Quotes[0];
  assert.equal(row[7], 'Review deck');
  assert.equal(row[10], 'Filming only: $6,000 USD | Filming + post: $6,500 USD');
  assert.equal(row[12], 'https://docs.google.com/deck1');
  assert.equal(appended.Log[0][4], 'quote');

  const live = slides.filter((s) => !s.removed);
  assert.equal(live.filter((s) => s.notes === '#samples corporate').length, 0, 'unrelated samples removed');
  const inv = live.filter((s) => s.notes === '#investment');
  assert.equal(inv.length, 2);
  const cellText = (t) => t.rows.map((r) => r.cells.map((c) => c.asString()));
  const second = cellText(inv[1].table);
  assert.equal(second.length, 1 + 2 + 2, 'header + 2 lines + subtotal + total (no VAT row in USD)');
  assert.deepEqual(second[2], ['Editing', '10', '$50 USD', '$500 USD']);
  assert.equal(second[4][3], '$6,500 USD');
});

test('not-a-request email is only logged', () => {
  const { sandbox, appended } = buildSandbox([{ type: 'not_a_request', language: 'en', reason: 'vendor pitch' }]);
  vm.runInContext('processMessage_(t, [m], loadCatalog_(), SpreadsheetApp.openById("k"))', Object.assign(sandbox, { t: fakeThread, m: fakeMessage }));
  assert.equal(appended.Quotes.length, 0);
  assert.equal(appended.Log[0][3], 'not_a_request');
});

test('an API outage never loses the lead: retried, then shown as an error row', () => {
  const { sandbox, appended, props } = buildSandbox([], { apiDown: true, threads: [fakeThread] });
  vm.runInContext('run_(3)', sandbox);
  vm.runInContext('run_(3)', sandbox);
  assert.equal(appended.Quotes.length, 0, 'no row while retrying');
  assert.equal(appended.Log.length, 0, 'not marked processed while retrying');
  assert.equal(props['attempts_m1'], '2');
  vm.runInContext('run_(3)', sandbox);
  assert.equal(appended.Quotes.length, 1);
  assert.equal(appended.Quotes[0][7], 'Error: handle by hand');
  assert.equal(appended.Quotes[0][1], 'info@intelygente.net');
  assert.equal(props['attempts_m1'], undefined);
});

test('a thread where Pablo wrote last is skipped', () => {
  const mine = Object.assign({}, fakeMessage, { getFrom: () => 'Pablo <info@intelygente.net>' });
  const thread = Object.assign({}, fakeThread, { getMessages: () => [fakeMessage, mine] });
  const { sandbox, appended } = buildSandbox([], { threads: [thread] });
  assert.equal(vm.runInContext('run_(3)', sandbox), true);
  assert.equal(appended.Quotes.length + appended.Log.length, 0);
});

test('shared inboxes are searched in full, the personal inbox only with quote keywords', () => {
  const { sandbox } = buildSandbox([]);
  const q = vm.runInContext('buildQuery_(3)', sandbox);
  assert.match(q, /^\(to:info@intelygente\.net OR deliveredto:info@intelygente\.net OR to:director@yellowfilmmachine\.com/);
  assert.match(q, /\(\(to:pablo\.castro@intelygente\.net OR deliveredto:pablo\.castro@intelygente\.net\) \(cotización OR /);
  assert.match(q, /newer_than:3d/);
});
