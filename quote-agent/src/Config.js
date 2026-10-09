/**
 * Config.js: everything Pablo may want to change, in one place.
 * Secrets and file IDs live in Script Properties (Project Settings > Script
 * Properties), never in this file. This repository is public.
 *
 * Required Script Properties:
 *   ANTHROPIC_API_KEY   Claude API key (console.anthropic.com)
 *   RATE_SHEET_ID       ID of the rate sheet spreadsheet
 *   TEMPLATE_ID_EN      ID of the English quote deck template
 *   TRACKER_ID          ID of the tracker spreadsheet (created by setup())
 *   DECKS_FOLDER_ID     Drive folder for generated decks (created by setup())
 * Optional:
 *   TEMPLATE_ID_ES      Spanish deck template. Without it, Spanish requests
 *                       get the English deck and the tracker flags it.
 *   DRY_RUN             "false" to allow Gmail drafts (Phase 2). Default true.
 */

var CONFIG = {
  // Inboxes the agent watches. Replies go out from the inbox that received
  // the request (Phase 2). Order matters: when a thread reached several of
  // them, the first match wins.
  INBOXES: ['info@intelygente.net', 'director@yellowfilmmachine.com', 'pablo.castro@intelygente.net'],

  // Personal inboxes get far more email than the shared ones. To keep the
  // Claude bill small, only emails that mention a quote-related word are
  // sent to Claude from these. Shared inboxes are checked in full.
  KEYWORD_INBOXES: ['pablo.castro@intelygente.net'],
  QUOTE_KEYWORDS: ['cotización', 'cotizacion', 'cotizar', 'presupuesto', 'tarifa', 'tarifas',
    'propuesta', 'precio', 'precios', 'costo', 'costos', 'valor', 'quote', 'quotation', 'estimate',
    'budget', 'rates', 'proposal', 'pricing', 'price', 'prices', 'cost'],

  // How far back the first run looks, and how far back scheduled runs look.
  // Scheduled runs happen every RUN_EVERY_HOURS hours (1, 2, 4, 6, 8 or 12).
  RUN_EVERY_HOURS: 4,
  FIRST_RUN_DAYS: 28,
  DAILY_LOOKBACK_DAYS: 3,

  // Gmail label added to threads that contain a quote request. What was
  // already processed is tracked by message ID in the tracker's Log tab.
  LABEL_QUOTE: 'quote-agent/quote-request',

  // Claude models. Opus is the default. Triage runs at low effort to keep
  // cost down; switch TRIAGE_MODEL to 'claude-haiku-5-5' to cut it further.
  TRIAGE_MODEL: 'claude-opus-5-5',
  TRIAGE_EFFORT: 'low',
  EXTRACT_MODEL: 'claude-opus-5-5',
  EXTRACT_EFFORT: 'medium',

  // Rate sheet layout (tab name and range read every run, never cached).
  RATE_SHEET_TAB: 'RATE SHEET',
  RATE_SHEET_RANGE: 'A1:E200',
  ASSUMPTIONS_TAB: 'Assumptions',
  TRM_CELL: 'B4',

  // Colombian VAT (IVA). Shown as its own line for COP quotes.
  VAT_RATE_CO: 0.19,

  // Filled at run time from the Assumptions tab.
  TRM: null,

  // Billing entity, currency and payment terms, chosen by the client's
  // country (not by the inbox). The model never writes or picks these.
  BILLING: {
    colombia: {
      name: 'Intelygente SAS',
      currency: 'COP',
      paymentTerms: '50% de anticipo para reservar fechas, 50% contra entrega final.',
      paymentTermsEn: '50% advance deposit to lock dates, 50% upon final delivery.',
      billingNote: 'Facturación a nombre de Intelygente SAS (Colombia).',
      billingNoteEn: 'Invoiced by Intelygente SAS (Colombia).',
    },
    international: {
      name: 'Yellow Film Machine LLC',
      currency: 'USD',
      paymentTerms: '50% de anticipo para reservar fechas, 50% contra entrega final.',
      paymentTermsEn: '50% advance deposit to lock dates, 50% upon final delivery.',
      billingNote: 'Facturación y pagos a Yellow Film Machine LLC (EE. UU.), cuenta bancaria Chase en EE. UU.',
      billingNoteEn: 'Invoice and payment transfers to Yellow Film Machine LLC (USA), US Chase bank account.',
    },
  },

  CANCELLATION_EN: 'Cancellation policy: 72 hours in advance: 25% charge, 48 hours: 50%, 24 hours or less: 100%.',
  CANCELLATION_ES: 'Política de cancelación: con 72 horas de anticipación: 25%, 48 horas: 50%, 24 horas o menos: 100%.',

  // Sample-slide categories the model may choose from. Each "Relevant
  // Samples" slide in the template has a speaker note like
  // "#samples automotive corporate".
  SAMPLE_CATEGORIES: ['automotive', 'corporate', 'interview', 'industrial', 'energy', 'aerial', 'commercial', 'documentary', 'photography', 'event', 'animation', 'social'],

  // Number of empty line rows in the template's investment table.
  TEMPLATE_TABLE_ROWS: 12,

  // Apps Script stops a run after about 6 minutes. Stop picking up new
  // emails after this many milliseconds; the next run continues.
  TIME_BUDGET_MS: 4.5 * 60 * 1000,

  // A message whose processing fails is retried on later runs this many
  // times before it is shown in the tracker as an error.
  MAX_ATTEMPTS: 3,
};

function prop_(key, required) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !value) throw new Error('Missing Script Property: ' + key + '. See quote-agent/SETUP.md.');
  return value;
}

function isDryRun_() {
  return prop_('DRY_RUN', false) !== 'false';
}
