# Quote Agent

Turns quote requests that arrive by email into draft quote decks for Pablo to review.

**Phase 1 (this code):** every 4 hours it reads info@intelygente.net, director@yellowfilmmachine.com and pablo.castro@intelygente.net (that last one only for emails that mention a quote), sorts each new email into quotable, needs info, complex/tender, or not a request. For quote requests it prices the work from the rate sheet, copies the deck template, fills it in and adds a row to a tracker sheet. It never sends or drafts email.

**Phase 2 (next):** once a deck is approved in the tracker, draft the reply email in Gmail with the deck link. Pablo presses Send.

**Phase 3 (after that):** short, low-pressure follow-ups (at most 3), stopping as soon as the client replies.

## How it stays safe
- Claude never sets a price. It only picks rate sheet items and quantities. Code does the math, and anything it cannot map is flagged for Pablo.
- The internal floor price (MAX DISCOUNT RATE) never enters a prompt or a deck. It only appears in the tracker's internal column.
- Billing entity, currency, VAT and payment terms come from settings, decided by the client's country (Colombia: Intelygente SAS in COP plus IVA; everyone else: Yellow Film Machine LLC in USD). Never from the AI.
- If Claude or Google fails, the email is retried on later runs and then shown as an error. No lead is dropped silently.
- Email content is treated as data, never as instructions.
- No secrets, rates or client data live in this repository (it is public). Keys and file IDs go in Script Properties.

## Files
- `src/Core.js`: pricing, validation and routing. Pure logic, tested under Node.
- `src/Prompts.js`: the two Claude prompts and their JSON schemas.
- `src/Claude.js`: the Claude API call.
- `src/Main.js`: Gmail, rate sheet, deck and tracker wiring.
- `src/Config.js`: settings.
- `dist/QuoteAgent.gs`: all of the above in one file to paste into Apps Script (`npm run build`).
- `SETUP.md`: step by step setup.

## Tests
`npm test` runs the pricing and routing tests plus a smoke test of the whole pipeline against fake Google services and a fake Claude API. The fixture uses made-up prices.
