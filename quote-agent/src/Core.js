/**
 * Core.js: pure logic with no Google or network calls.
 * Runs inside Apps Script and under Node (for tests).
 *
 * Rule of the system: the model never sets a price. It only picks catalog
 * item ids and quantities. Everything numeric happens here.
 */

var Core = (function () {
  var TRIAGE_TYPES = ['quotable', 'needs_info', 'complex', 'not_a_request'];

  /** "$1,100" -> 1100. Returns null when the cell is not a money value. */
  function parseMoney(value) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return null;
    var cleaned = String(value).replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    var n = Number(cleaned);
    return isNaN(n) ? null : n;
  }

  /**
   * Turns the RATE SHEET values into a catalog.
   * rows: 2D array read from the sheet starting at row `firstRow` (1-based).
   * Expected columns (0-based): 1 description, 2 time, 3 list USD, 4 floor USD.
   * Section headers are rows with a description and no list price.
   * Item ids are "R<row number>" so they stay readable in the tracker.
   */
  function parseCatalog(rows, firstRow) {
    var items = [];
    var section = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [];
      var desc = r[1] ? String(r[1]).trim() : '';
      if (!desc) continue;
      var list = parseMoney(r[3]);
      var floor = parseMoney(r[4]);
      if (list === null) {
        if (desc.toUpperCase() === desc || floor === null) section = desc;
        continue;
      }
      if (desc.toUpperCase().indexOf('SERVICE DESCRIPTION') === 0) continue;
      items.push({
        id: 'R' + (firstRow + i),
        section: section,
        description: desc,
        time: r[2] ? String(r[2]).trim() : '',
        list: list,
        floor: floor === null ? list : floor,
      });
    }
    return items;
  }

  /**
   * Catalog text the model sees. Floor prices are deliberately left out:
   * the sheet marks them internal, so they never enter a prompt.
   */
  function catalogForPrompt(items) {
    return items
      .map(function (it) {
        return it.id + ' | ' + it.section + ' | ' + it.description +
          (it.time ? ' | ' + it.time : '') + ' | USD ' + it.list;
      })
      .join('\n');
  }

  function indexById(items) {
    var map = {};
    items.forEach(function (it) { map[it.id] = it; });
    return map;
  }

  /**
   * Checks the model's extraction against the catalog. Unknown ids and bad
   * quantities are moved to `unpriced` instead of being priced.
   * Returns { extraction, problems }.
   */
  function validateExtraction(ex, items) {
    var problems = [];
    var byId = indexById(items);
    var out = JSON.parse(JSON.stringify(ex || {}));
    out.options = Array.isArray(out.options) ? out.options : [];
    out.unpriced = Array.isArray(out.unpriced) ? out.unpriced : [];

    out.options.forEach(function (opt, oi) {
      opt.lines = (opt.lines || []).filter(function (line) {
        var item = byId[line.item_id];
        var qty = Number(line.quantity);
        if (!item) {
          problems.push('Option ' + (oi + 1) + ': unknown item ' + line.item_id);
          out.unpriced.push({ description: line.note || line.item_id, reason: 'Model picked an item that is not in the rate sheet' });
          return false;
        }
        if (!(qty > 0) || qty > 500) {
          problems.push('Option ' + (oi + 1) + ': bad quantity for ' + line.item_id);
          out.unpriced.push({ description: item.description, reason: 'Quantity unclear' });
          return false;
        }
        line.quantity = qty;
        return true;
      });
    });
    out.options = out.options.filter(function (opt) { return opt.lines.length > 0; });
    return { extraction: out, problems: problems };
  }

  /** Rounding for client-facing COP amounts: nearest 1,000. */
  function roundCop(n) { return Math.round(n / 1000) * 1000; }

  /**
   * Prices every option. All math happens on USD list and floor values from
   * the sheet; COP is a conversion at the sheet's TRM.
   * money: { currency: 'USD'|'COP', trm: number, vatRate: number (0.19) or 0 }
   */
  function priceOptions(extraction, items, money) {
    var byId = indexById(items);
    var toClient = function (usd) {
      return money.currency === 'COP' ? roundCop(usd * money.trm) : Math.round(usd * 100) / 100;
    };
    return extraction.options.map(function (opt) {
      var listUsd = 0;
      var floorUsd = 0;
      var lines = opt.lines.map(function (line) {
        var item = byId[line.item_id];
        listUsd += item.list * line.quantity;
        floorUsd += item.floor * line.quantity;
        return {
          item_id: item.id,
          description: line.label || item.description,
          quantity: line.quantity,
          unit: toClient(item.list),
          total: toClient(item.list) * line.quantity,
        };
      });
      var subtotal = lines.reduce(function (s, l) { return s + l.total; }, 0);
      var vat = 0;
      if (money.vatRate) {
        vat = money.currency === 'COP'
          ? roundCop(subtotal * money.vatRate)
          : Math.round(subtotal * money.vatRate * 100) / 100;
      }
      return {
        name: opt.name || 'Option',
        currency: money.currency,
        lines: lines,
        subtotal: subtotal,
        vat: vat,
        total: subtotal + vat,
        // Internal only: never written to a client-facing document.
        internal: { listUsd: listUsd, floorUsd: floorUsd },
      };
    });
  }

  /**
   * Picks billing entity, currency and tax from the client's country. The
   * model has no say here. Colombian clients: Intelygente SAS in COP plus
   * IVA. Everyone else: Yellow Film Machine LLC in USD.
   */
  function pickBilling(clientCountry, config) {
    var colombian = /colomb/i.test(String(clientCountry || ''));
    var entity = colombian ? config.BILLING.colombia : config.BILLING.international;
    return {
      entity: entity,
      money: {
        currency: entity.currency,
        trm: config.TRM,
        vatRate: entity.currency === 'COP' ? config.VAT_RATE_CO : 0,
      },
    };
  }

  /**
   * What the system does with a triaged email.
   * Returns one of: 'ignore', 'brief', 'ask_for_info', 'quote', 'quote_with_gaps'.
   */
  function decideAction(triageType, validated) {
    if (TRIAGE_TYPES.indexOf(triageType) === -1 || triageType === 'not_a_request') return 'ignore';
    if (triageType === 'complex') return 'brief';
    if (triageType === 'needs_info') return 'ask_for_info';
    var ex = validated.extraction;
    if (!ex.options.length) return 'ask_for_info';
    return ex.unpriced.length ? 'quote_with_gaps' : 'quote';
  }

  function formatMoney(n, currency) {
    var s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, currency === 'COP' ? '.' : ',');
    return '$' + s + ' ' + currency;
  }

  /** Short line for the tracker: "Filming only: $X USD | Filming + post: $Y USD". */
  function summarizeTotals(priced) {
    return priced.map(function (p) { return p.name + ': ' + formatMoney(p.total, p.currency); }).join(' | ');
  }

  /** Internal floor check, tracker only. */
  function floorCheck(priced) {
    return priced.map(function (p) {
      return p.name + ': list $' + Math.round(p.internal.listUsd) + ' / floor $' + Math.round(p.internal.floorUsd) + ' USD';
    }).join(' | ');
  }

  return {
    TRIAGE_TYPES: TRIAGE_TYPES,
    parseMoney: parseMoney,
    parseCatalog: parseCatalog,
    catalogForPrompt: catalogForPrompt,
    validateExtraction: validateExtraction,
    priceOptions: priceOptions,
    pickBilling: pickBilling,
    decideAction: decideAction,
    formatMoney: formatMoney,
    summarizeTotals: summarizeTotals,
    floorCheck: floorCheck,
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
