/**
 * Main.js: Phase 1 of the quote agent.
 *
 *   Gmail -> triage (Claude) -> scope extraction (Claude) -> pricing (code)
 *         -> quote deck copy (Slides) -> tracker row (Sheets)
 *
 * Phase 1 never sends or drafts email. It only prepares decks and tracker
 * rows for Pablo to review.
 */

var TRACKER_HEADERS = [
  'Received', 'Inbox', 'From', 'Company', 'Subject', 'Thread', 'Type', 'Status',
  'Language', 'Currency', 'Totals (client)', 'Floor check (internal)', 'Deck',
  'Unpriced items', 'Missing info', 'Summary', 'Approve deck', 'Notes', 'Message ID',
];
var LOG_HEADERS = ['Processed at', 'Message ID', 'Thread ID', 'Type', 'Result'];

/** Run once from the Apps Script editor. Creates tracker, folder, labels, trigger. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  prop_('ANTHROPIC_API_KEY', true);
  prop_('RATE_SHEET_ID', true);
  prop_('TEMPLATE_ID_EN', true);

  if (!props.getProperty('TRACKER_ID')) {
    var ss = SpreadsheetApp.create('Quote Agent Tracker');
    var quotes = ss.getSheets()[0].setName('Quotes');
    quotes.appendRow(TRACKER_HEADERS);
    quotes.setFrozenRows(1);
    quotes.getRange(1, 1, 1, TRACKER_HEADERS.length).setFontWeight('bold');
    var log = ss.insertSheet('Log');
    log.appendRow(LOG_HEADERS);
    log.setFrozenRows(1);
    props.setProperty('TRACKER_ID', ss.getId());
  }
  if (!props.getProperty('DECKS_FOLDER_ID')) {
    props.setProperty('DECKS_FOLDER_ID', DriveApp.createFolder('Quote Agent Decks').getId());
  }
  if (!props.getProperty('DRY_RUN')) props.setProperty('DRY_RUN', 'true');

  GmailApp.getUserLabelByName(CONFIG.LABEL_QUOTE) || GmailApp.createLabel(CONFIG.LABEL_QUOTE);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduled') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runScheduled').timeBased().everyHours(1).create();

  Logger.log('Setup done. Tracker: ' + SpreadsheetApp.openById(prop_('TRACKER_ID', true)).getUrl());
}

/**
 * First run: looks back several weeks so Pablo can compare with what he
 * actually sent. Safe to run again: it skips what is already processed and
 * says in the log when there is nothing left.
 */
function runBackfill() {
  var done = run_(CONFIG.FIRST_RUN_DAYS);
  Logger.log(done ? 'Backfill finished.' : 'Time limit reached. Run runBackfill again to continue.');
}

/** Hourly trigger. */
function runScheduled() { run_(CONFIG.DAILY_LOOKBACK_DAYS); }

/** Returns true when every matching thread was looked at. */
function run_(lookbackDays) {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return false;
  try {
    var tracker = SpreadsheetApp.openById(prop_('TRACKER_ID', true));
    var processed = loadProcessedIds_(tracker);
    var catalog = loadCatalog_();
    var myAddresses = myAddresses_();
    var query = buildQuery_(lookbackDays);

    for (var start = 0; ; start += 50) {
      var threads = GmailApp.search(query, start, 50);
      if (!threads.length) return true;
      for (var i = 0; i < threads.length; i++) {
        if (Date.now() - started > CONFIG.TIME_BUDGET_MS) return false;
        var thread = threads[i];
        var messages = thread.getMessages();
        var last = messages[messages.length - 1];
        if (processed[last.getId()]) continue;
        // If Pablo wrote last, the ball is in the client's court.
        if (isFromMe_(last, myAddresses)) continue;
        try {
          processMessage_(thread, messages, catalog, tracker);
          clearAttempts_(last.getId());
        } catch (err) {
          handleFailure_(tracker, thread, last, err);
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * A failure (no credits, timeout, API outage) must never lose a lead. The
 * message is retried on the next runs; after MAX_ATTEMPTS it shows up in the
 * Quotes tab as an error for Pablo to handle by hand.
 */
function handleFailure_(tracker, thread, last, err) {
  var key = 'attempts_' + last.getId();
  var props = PropertiesService.getScriptProperties();
  var attempts = Number(props.getProperty(key) || 0) + 1;
  var message = String(err && err.message || err);
  Logger.log('Failed on ' + thread.getFirstMessageSubject() + ' (attempt ' + attempts + '): ' + message);
  if (attempts < CONFIG.MAX_ATTEMPTS) {
    props.setProperty(key, String(attempts));
    return;
  }
  props.deleteProperty(key);
  tracker.getSheetByName('Quotes').appendRow([
    last.getDate(), detectInbox_(thread.getMessages()), last.getFrom(), '', thread.getFirstMessageSubject(),
    thread.getPermalink(), 'error', 'Error: handle by hand', '', '', '', '', '', '', '', message, false, '', last.getId(),
  ]);
  logResult_(tracker, last, thread, 'error', message);
}

function clearAttempts_(messageId) {
  PropertiesService.getScriptProperties().deleteProperty('attempts_' + messageId);
}

function buildQuery_(days) {
  var inboxes = CONFIG.INBOXES.map(function (a) { return 'to:' + a + ' OR deliveredto:' + a; }).join(' OR ');
  return '(' + inboxes + ') newer_than:' + days + 'd -category:promotions -category:social -in:chats';
}

/** Pablo's own addresses: his account plus its "Send mail as" aliases. */
function myAddresses_() {
  var list = [Session.getActiveUser().getEmail()].concat(GmailApp.getAliases());
  return list.map(function (a) { return String(a).toLowerCase(); });
}

function isFromMe_(msg, myAddresses) {
  var from = msg.getFrom().toLowerCase();
  return myAddresses.some(function (a) { return a && from.indexOf(a) !== -1; });
}

/** Which watched inbox the thread came to. Checks the first message first. */
function detectInbox_(messages) {
  for (var m = 0; m < messages.length; m++) {
    var msg = messages[m];
    var haystack = [msg.getTo(), msg.getCc(), msg.getHeader('Delivered-To')].join(' ').toLowerCase();
    for (var i = 0; i < CONFIG.INBOXES.length; i++) {
      if (haystack.indexOf(CONFIG.INBOXES[i]) !== -1) return CONFIG.INBOXES[i];
    }
  }
  return 'unknown';
}

/** Latest message plus up to two earlier ones for context, trimmed. */
function threadText_(messages) {
  return messages.slice(-3).map(function (m) {
    return '--- ' + m.getFrom() + ' on ' + m.getDate() + '\n' + m.getPlainBody().slice(0, 6000);
  }).join('\n\n');
}

function processMessage_(thread, messages, catalog, tracker) {
  var last = messages[messages.length - 1];
  var inbox = detectInbox_(messages);
  var msg = {
    inbox: inbox,
    from: last.getFrom(),
    subject: thread.getFirstMessageSubject(),
    attachments: last.getAttachments().map(function (a) { return a.getName(); }),
    body: threadText_(messages),
  };
  var emailText = PROMPTS.emailBlock(msg);

  // 1. Triage (cheap, no rate sheet in the prompt).
  var triage = claudeJson_(CONFIG.TRIAGE_MODEL, CONFIG.TRIAGE_EFFORT, PROMPTS.TRIAGE_SYSTEM, emailText, PROMPTS.TRIAGE_SCHEMA);
  if (triage.type === 'not_a_request') {
    logResult_(tracker, last, thread, triage.type, triage.reason);
    return;
  }

  // 2. Scope extraction against the live rate sheet.
  var raw = claudeJson_(CONFIG.EXTRACT_MODEL, CONFIG.EXTRACT_EFFORT,
    PROMPTS.extractSystem(Core.catalogForPrompt(catalog), CONFIG.SAMPLE_CATEGORIES),
    emailText + '\n\nTriage: ' + triage.type + '. Client language: ' + triage.language + '.',
    PROMPTS.EXTRACT_SCHEMA);
  var validated = Core.validateExtraction(raw, catalog);
  var ex = validated.extraction;
  var action = Core.decideAction(triage.type, validated);

  // 3. Pricing, billing entity and currency come from code and config only.
  var billing = Core.pickBilling(ex.client.country, CONFIG);
  var priced = Core.priceOptions(ex, catalog, billing.money);

  // 4. Deck only for quotable requests. Tenders and vague requests get a brief in the tracker.
  var deckUrl = '';
  var notes = validated.problems.slice();
  if (action === 'quote' || action === 'quote_with_gaps') {
    var deck = buildDeck_(ex, priced, billing, triage.language);
    deckUrl = deck.url;
    notes = notes.concat(deck.notes);
  }

  thread.addLabel(GmailApp.getUserLabelByName(CONFIG.LABEL_QUOTE));
  appendTrackerRow_(tracker, {
    last: last, thread: thread, inbox: inbox, triage: triage, ex: ex, priced: priced,
    action: action, deckUrl: deckUrl, notes: notes,
  });
  logResult_(tracker, last, thread, triage.type, action);
}

var STATUS_LABELS = {
  quote: 'Review deck',
  quote_with_gaps: 'Review deck: some items need your price',
  ask_for_info: 'Ask client for details',
  brief: 'Tender or complex: Pablo quotes',
};

function appendTrackerRow_(tracker, r) {
  var sheet = tracker.getSheetByName('Quotes');
  var currency = r.priced.length ? r.priced[0].currency : '';
  sheet.appendRow([
    r.last.getDate(),
    r.inbox,
    r.last.getFrom(),
    r.ex.client.company,
    r.thread.getFirstMessageSubject(),
    r.thread.getPermalink(),
    r.triage.type,
    STATUS_LABELS[r.action] || r.action,
    r.triage.language,
    currency,
    Core.summarizeTotals(r.priced),
    Core.floorCheck(r.priced),
    r.deckUrl,
    r.ex.unpriced.map(function (u) { return u.description + ' (' + u.reason + ')'; }).join('\n'),
    r.ex.missing_info.join('\n'),
    r.ex.summary + (r.action === 'brief' ? '\n\nDraft lines: ' + draftLinesText_(r.priced) : ''),
    false,
    r.notes.join('\n'),
    r.last.getId(),
  ]);
  var row = sheet.getLastRow();
  sheet.getRange(row, TRACKER_HEADERS.indexOf('Approve deck') + 1).insertCheckboxes();
}

function draftLinesText_(priced) {
  return priced.map(function (p) {
    return p.name + ': ' + p.lines.map(function (l) { return l.quantity + ' x ' + l.description; }).join('; ');
  }).join(' || ');
}

function logResult_(tracker, msg, thread, type, result) {
  tracker.getSheetByName('Log').appendRow([new Date(), msg.getId(), thread.getId(), type, result]);
}

function loadProcessedIds_(tracker) {
  var log = tracker.getSheetByName('Log');
  var last = log.getLastRow();
  var ids = {};
  if (last < 2) return ids;
  log.getRange(2, 2, last - 1, 1).getValues().forEach(function (r) { ids[r[0]] = true; });
  return ids;
}

/** Reads the rate sheet and TRM fresh on every run. */
function loadCatalog_() {
  var ss = SpreadsheetApp.openById(prop_('RATE_SHEET_ID', true));
  var values = ss.getSheetByName(CONFIG.RATE_SHEET_TAB).getRange(CONFIG.RATE_SHEET_RANGE).getDisplayValues();
  var trm = Core.parseMoney(ss.getSheetByName(CONFIG.ASSUMPTIONS_TAB).getRange(CONFIG.TRM_CELL).getDisplayValue());
  if (!trm) throw new Error('Could not read the TRM from ' + CONFIG.ASSUMPTIONS_TAB + '!' + CONFIG.TRM_CELL);
  CONFIG.TRM = trm;
  var catalog = Core.parseCatalog(values, 1);
  if (catalog.length < 10) throw new Error('Rate sheet looks empty or its layout changed.');
  return catalog;
}

/* ---------------------------- Deck building ---------------------------- */

/**
 * Template conventions (see SETUP.md, step 4):
 *  - Text placeholders anywhere: {{CLIENT_COMPANY}} {{CLIENT_NAME}} {{PROJECT_TITLE}}
 *    {{INTRO}} {{SELLING_POINTS}} {{DELIVERABLES}} {{TERMS}} {{DATE}}
 *  - Investment slide: speaker notes contain "#investment". Its title holds
 *    {{OPTION_NAME}}. Its first table has a header row, then
 *    CONFIG.TEMPLATE_TABLE_ROWS empty item rows, then rows containing
 *    {{SUBTOTAL}}, {{VAT}} and {{TOTAL}}.
 *  - Sample slides: speaker notes contain "#samples" plus categories.
 */
function buildDeck_(ex, priced, billing, language) {
  var notes = [];
  var templateId = language === 'es' ? prop_('TEMPLATE_ID_ES', false) : null;
  if (language === 'es' && !templateId) notes.push('Client wrote in Spanish but there is no Spanish template yet: deck is in English.');
  var useSpanish = !!templateId;
  templateId = templateId || prop_('TEMPLATE_ID_EN', true);

  var name = 'Quote - ' + (ex.client.company || 'Client') + ' - ' + ex.project_title + ' - ' +
    Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  var copy = DriveApp.getFileById(templateId).makeCopy(name, DriveApp.getFolderById(prop_('DECKS_FOLDER_ID', true)));
  var deck = SlidesApp.openById(copy.getId());

  var entity = billing.entity;
  var terms = useSpanish
    ? [entity.billingNote, entity.paymentTerms, CONFIG.CANCELLATION_ES]
    : [entity.billingNoteEn, entity.paymentTermsEn, CONFIG.CANCELLATION_EN];
  if (billing.money.currency === 'COP') {
    terms.push(useSpanish ? 'Valores en pesos colombianos. IVA incluido como línea aparte.' : 'Amounts in Colombian pesos. VAT shown as a separate line.');
  } else {
    terms.push(useSpanish ? 'Valores en dólares estadounidenses. No incluye impuestos locales.' : 'Amounts in US dollars. Local taxes not included.');
  }

  var replacements = {
    '{{CLIENT_COMPANY}}': ex.client.company,
    '{{CLIENT_NAME}}': ex.client.contact_name,
    '{{PROJECT_TITLE}}': ex.project_title,
    '{{INTRO}}': ex.intro,
    '{{SELLING_POINTS}}': ex.selling_points.join('\n'),
    '{{DELIVERABLES}}': ex.deliverables,
    '{{TERMS}}': terms.join('\n'),
    '{{DATE}}': Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd'),
  };
  Object.keys(replacements).forEach(function (k) { deck.replaceAllText(k, replacements[k] || ''); });

  fillInvestmentSlides_(deck, priced, notes);
  pruneSampleSlides_(deck, ex.sample_categories);
  deck.saveAndClose();
  return { url: copy.getUrl(), notes: notes };
}

function slideNotes_(slide) {
  return slide.getNotesPage().getSpeakerNotesShape().getText().asString();
}

function fillInvestmentSlides_(deck, priced, notes) {
  var base = deck.getSlides().filter(function (s) { return slideNotes_(s).indexOf('#investment') !== -1; })[0];
  if (!base) { notes.push('Template has no #investment slide: prices not inserted.'); return; }

  // One investment slide per option, in order.
  var slides = [base];
  for (var i = 1; i < priced.length; i++) {
    slides.push(slides[slides.length - 1].duplicate());
  }
  priced.forEach(function (option, idx) {
    var slide = slides[idx];
    slide.replaceAllText('{{OPTION_NAME}}', priced.length > 1 ? option.name : '');
    var table = slide.getTables()[0];
    if (!table) { notes.push('Investment slide has no table.'); return; }
    fillTable_(table, option, notes);
  });
  if (!priced.length) base.remove();
}

function fillTable_(table, option, notes) {
  var first = 1;
  var slots = CONFIG.TEMPLATE_TABLE_ROWS;
  var lines = option.lines;
  // Add rows if the option has more lines than the template has slots.
  while (slots < lines.length) {
    table.insertRow(first + slots - 1);
    slots++;
  }
  for (var i = 0; i < slots; i++) {
    var row = table.getRow(first + i);
    var line = lines[i];
    if (!line) continue;
    row.getCell(0).getText().setText(line.description);
    row.getCell(1).getText().setText(String(line.quantity));
    row.getCell(2).getText().setText(Core.formatMoney(line.unit, option.currency));
    row.getCell(3).getText().setText(Core.formatMoney(line.total, option.currency));
  }
  // Remove unused slots from the bottom up.
  for (var j = slots - 1; j >= lines.length; j--) table.getRow(first + j).remove();

  replaceInTable_(table, '{{SUBTOTAL}}', Core.formatMoney(option.subtotal, option.currency));
  replaceInTable_(table, '{{TOTAL}}', Core.formatMoney(option.total, option.currency));
  if (option.vat) {
    replaceInTable_(table, '{{VAT}}', Core.formatMoney(option.vat, option.currency));
  } else {
    removeRowContaining_(table, '{{VAT}}');
  }
}

function replaceInTable_(table, find, value) {
  for (var r = 0; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    for (var c = 0; c < row.getNumCells(); c++) {
      row.getCell(c).getText().replaceAllText(find, value);
    }
  }
}

function removeRowContaining_(table, find) {
  for (var r = table.getNumRows() - 1; r >= 0; r--) {
    var row = table.getRow(r);
    for (var c = 0; c < row.getNumCells(); c++) {
      if (row.getCell(c).getText().asString().indexOf(find) !== -1) { row.remove(); break; }
    }
  }
}

/** Keeps sample slides whose tags match; always keeps at least one. */
function pruneSampleSlides_(deck, categories) {
  var wanted = (categories || []).map(function (c) { return String(c).toLowerCase(); });
  var samples = deck.getSlides().filter(function (s) { return slideNotes_(s).indexOf('#samples') !== -1; });
  if (!samples.length) return;
  var keep = samples.filter(function (s) {
    var tags = slideNotes_(s).toLowerCase();
    return wanted.some(function (c) { return tags.indexOf(c) !== -1; });
  });
  if (!keep.length) keep = [samples[0]];
  samples.forEach(function (s) { if (keep.indexOf(s) === -1) s.remove(); });
}
