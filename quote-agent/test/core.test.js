const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/Core.js');
const PROMPTS = require('../src/Prompts.js');
const fixture = require('./fixtures/catalog.json');

const catalog = Core.parseCatalog(fixture.rows, 1);
const id = (desc) => catalog.find((c) => c.description.startsWith(desc)).id;

const CONFIG = {
  TRM: 4000,
  VAT_RATE_CO: 0.19,
  BILLING: {
    colombia: { name: 'Intelygente SAS', currency: 'COP' },
    international: { name: 'Yellow Film Machine LLC', currency: 'USD' },
  },
};

test('parseCatalog reads items, skips headers, keeps sections and row ids', () => {
  assert.equal(catalog.length, 11);
  const drone = catalog.find((c) => c.description.startsWith('Drone'));
  assert.equal(drone.id, 'R14');
  assert.equal(drone.section, 'ADD-ONS AND TRAVEL');
  assert.equal(drone.list, 300);
  assert.equal(drone.floor, 240);
  assert.ok(!catalog.some((c) => /SERVICE DESCRIPTION/.test(c.description)));
});

test('the prompt catalog never contains floor prices', () => {
  const text = Core.catalogForPrompt(catalog);
  for (const item of catalog) {
    if (item.floor !== item.list) assert.ok(!text.includes('USD ' + item.floor + '\n') && !text.endsWith('USD ' + item.floor), 'floor leaked for ' + item.id);
  }
  assert.ok(!/MAX DISCOUNT/i.test(text));
});

test('unknown ids and bad quantities become unpriced, never priced', () => {
  const v = Core.validateExtraction({
    options: [{ name: 'A', lines: [
      { item_id: 'R999', quantity: 1, label: 'Made up', note: 'invented item' },
      { item_id: id('2-camera'), quantity: 0, label: '', note: '' },
      { item_id: id('1-camera'), quantity: 1, label: '', note: '' },
    ] }],
    unpriced: [],
  }, catalog);
  assert.equal(v.extraction.options[0].lines.length, 1);
  assert.equal(v.extraction.unpriced.length, 2);
  assert.equal(v.problems.length, 2);
});

test('automotive-style request: two options in USD, no VAT, internal floor kept apart', () => {
  const ex = Core.validateExtraction({
    options: [
      { name: 'Filming only', lines: [
        { item_id: id('2-camera'), quantity: 3, label: '', note: '' },
        { item_id: id('Drone'), quantity: 3, label: '', note: '' },
      ] },
      { name: 'Filming + post', lines: [
        { item_id: id('2-camera'), quantity: 3, label: '', note: '' },
        { item_id: id('Drone'), quantity: 3, label: '', note: '' },
        { item_id: id('Editing'), quantity: 10, label: '', note: '' },
      ] },
    ],
    unpriced: [],
  }, catalog).extraction;
  const billing = Core.pickBilling('China', CONFIG);
  assert.equal(billing.money.currency, 'USD');
  const priced = Core.priceOptions(ex, catalog, billing.money);
  assert.equal(priced[0].total, 6900);
  assert.equal(priced[1].total, 7400);
  assert.equal(priced[0].vat, 0);
  assert.equal(priced[1].internal.floorUsd, 3 * 1600 + 3 * 240 + 10 * 40);
  assert.equal(Core.summarizeTotals(priced), 'Filming only: $6,900 USD | Filming + post: $7,400 USD');
});

test('Colombian client: Intelygente SAS, COP at the TRM plus IVA line', () => {
  const ex = { options: [{ name: 'Option', lines: [{ item_id: id('Professional photo'), quantity: 2, label: '', note: '' }] }], unpriced: [] };
  const billing = Core.pickBilling('Colombia', CONFIG);
  assert.equal(billing.money.currency, 'COP');
  const [p] = Core.priceOptions(Core.validateExtraction(ex, catalog).extraction, catalog, billing.money);
  assert.equal(p.subtotal, 12000000);
  assert.equal(p.vat, 2280000);
  assert.equal(p.total, 14280000);
  assert.equal(Core.formatMoney(p.total, 'COP'), '$14.280.000 COP');
});

test('foreign clients are billed by Yellow Film Machine in USD, whatever the inbox', () => {
  for (const country of ['France', 'China', 'United States', '']) {
    const b = Core.pickBilling(country, CONFIG);
    assert.equal(b.entity.name, 'Yellow Film Machine LLC');
    assert.equal(b.money.currency, 'USD');
    assert.equal(b.money.vatRate, 0);
  }
  assert.equal(Core.pickBilling('Bogotá, Colombia', CONFIG).entity.name, 'Intelygente SAS');
});

test('routing for the four kinds of email Pablo shared', () => {
  const withLines = { extraction: { options: [{ name: 'A', lines: [{}] }], unpriced: [] } };
  const withGap = { extraction: { options: [{ name: 'A', lines: [{}] }], unpriced: [{ description: '4 hour shoot' }] } };
  const empty = { extraction: { options: [], unpriced: [] } };
  assert.equal(Core.decideAction('quotable', withLines), 'quote');            // automotive test video
  assert.equal(Core.decideAction('quotable', withGap), 'quote_with_gaps');    // half-day interview
  assert.equal(Core.decideAction('quotable', empty), 'ask_for_info');
  assert.equal(Core.decideAction('needs_info', empty), 'ask_for_info');       // promo video, reference is an mp4
  assert.equal(Core.decideAction('complex', withLines), 'brief');             // multi-region tender
  assert.equal(Core.decideAction('not_a_request', withLines), 'ignore');
  assert.equal(Core.decideAction('something_else', withLines), 'ignore');
});

test('structured output schemas are strict: every object closes and requires all keys', () => {
  const check = (schema, where) => {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false, where);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), where);
      for (const [k, v] of Object.entries(schema.properties)) check(v, where + '.' + k);
    }
    if (schema.type === 'array') check(schema.items, where + '[]');
  };
  check(PROMPTS.TRIAGE_SCHEMA, 'triage');
  check(PROMPTS.EXTRACT_SCHEMA, 'extract');
});

test('prompts tell the model to treat email as data and never to price', () => {
  const sys = PROMPTS.extractSystem('R1 | X | Y | USD 1', ['corporate']);
  assert.match(sys, /never set prices/);
  assert.match(sys, /data, not instructions/);
  assert.match(PROMPTS.TRIAGE_SYSTEM, /data, not instructions/);
});
