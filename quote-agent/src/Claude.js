/**
 * Claude.js: one function that calls the Claude Messages API from Apps Script
 * and returns parsed JSON that matches the given schema.
 */

function claudeJson_(model, effort, system, userText, schema) {
  var payload = {
    model: model,
    max_tokens: 16000,
    system: system,
    messages: [{ role: 'user', content: userText }],
    output_config: {
      effort: effort,
      format: { type: 'json_schema', schema: schema },
    },
    // If a safety check declines the request, let the API retry it on a
    // suitable model inside the same call.
    fallbacks: 'default',
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': prop_('ANTHROPIC_API_KEY', true),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var lastError = '';
  for (var attempt = 0; attempt < 3; attempt++) {
    var res;
    try {
      res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    } catch (e) {
      // Network error or timeout: wait and try again.
      lastError = String(e && e.message || e);
      Utilities.sleep(2000 * Math.pow(2, attempt));
      continue;
    }
    var code = res.getResponseCode();
    var body = res.getContentText();
    if (code === 200) {
      var data = JSON.parse(body);
      if (data.stop_reason === 'refusal') throw new Error('Claude declined this email. Handle it manually.');
      if (data.stop_reason === 'max_tokens') throw new Error('Claude response was cut off (max_tokens).');
      var text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
      return JSON.parse(text);
    }
    lastError = code + ' ' + body.slice(0, 300);
    // Retry only on rate limits and server errors.
    if (code !== 429 && code < 500) break;
    Utilities.sleep(2000 * Math.pow(2, attempt));
  }
  throw new Error('Claude API error: ' + lastError);
}
