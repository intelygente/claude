# Quote Agent: setup guide

Phase 1 reads your inboxes every 4 hours. It spots quote requests, prices them from your rate sheet, builds a draft deck and adds a row to a tracker sheet. It never sends or drafts emails. Phase 2 (email drafts) and Phase 3 (follow-ups) come after Phase 1 works on your real inbox.

Expect about 45 minutes the first time. Do the steps in order.

---

## Step 1. Get a Claude API key (10 min)

The API key lets your script talk to Claude. It is billed separately from your Claude subscription, pay as you go.

1. Go to **platform.claude.com** (the Claude Console) and sign up with pablo.castro@intelygente.net.
2. In the billing section, add a card and buy **$20 in credits**. That should last several months at your volume.
3. In the limits section, set a **monthly spend limit of $20**. If something goes wrong, it can never cost more than that.
4. In the API keys section, create a key named `quote-agent` and copy it. The console shows it only once, so paste it somewhere safe for Step 5.

Menu names change from time to time. If you can't find one of these, tell me what you see and I'll guide you.

**Expected cost:** around $5 to $10 a month. Every email that reaches the agent gets a short triage check (about 1 cent). Only real quote requests get the full pricing pass (about 5 to 10 cents each).

Never paste the key into an email, a chat or a file in GitHub. It only goes into the Script Properties in Step 5.

---

## Step 2. Check that both inboxes arrive in one Gmail (5 min)

The script runs inside a single Google account: pablo.castro@intelygente.net.

1. In that Gmail, search `to:info@intelygente.net`. If you see recent requests, that inbox is covered.
2. Search `to:director@yellowfilmmachine.com`. If nothing shows up, set up forwarding from that account to pablo.castro@intelygente.net:
   - In the Yellow Film Machine Gmail: **Settings > Forwarding and POP/IMAP > Add a forwarding address**.
   - Also add director@yellowfilmmachine.com as a **"Send mail as"** address in your main Gmail, so replies can go out from it in Phase 2.

Tell me if either search comes back empty and we will sort it out together.

Two things the agent does not watch yet, so tell me if they matter:
- Requests sent straight to pablo.castro@intelygente.net.
- Leads from your website contact form, if the form sends its emails from info@ itself.

---

## Step 3. Copy the IDs you will need (2 min)

A Google file ID is the long code in its link, between `/d/` and `/edit`.

- **Rate sheet ID:** from the rate sheet link.
- **Template IDs:** the two templates from Step 4.

---

## Step 4. Review the deck templates (10 min)

Claude already built both templates in your Drive from your sample deck. Your original deck was not touched.

- **TEMPLATE Quote EN** and **TEMPLATE Quote ES** (the Spanish one is a translation of the English one, so please read it once).

What changed compared with your sample deck:
1. **Title slide:** two new lines, `Prepared for {{CLIENT_COMPANY}}` and `{{PROJECT_TITLE}}`.
2. **Our Director:** the automotive line was removed, since it was specific to one client.
3. **New "Why Us for This Project" slide** after Our Director, with `{{INTRO}}` and `{{SELLING_POINTS}}`. This is where the custom selling points go.
4. **Investment slide:** title `Investment {{OPTION_NAME}}`, a clean table (header, 12 empty rows, then subtotal, VAT and total), and one text box with `{{DELIVERABLES}}` and `{{TERMS}}`. The old fixed text about payment, insurance and **"unlimited usage rights"** is gone, because your new rate sheet excludes usage rights. Payment terms, billing entity and cancellation policy now come from the settings, not from the AI.
5. **Speaker notes:** the investment slide has `#investment`. Each "Relevant Samples" slide has `#samples` followed by every category.

**Your 2-minute job:** on each "Relevant Samples" slide, open the speaker notes (below the slide) and delete the categories that slide does not show. For example, a slide with car work should keep `#samples automotive commercial aerial`. The agent keeps only the sample slides that match the request. Do it in both templates. Categories: automotive, corporate, interview, industrial, energy, aerial, commercial, documentary, photography, event, animation, social.

Also check the fonts and spacing of the new lines on the title slide and in the terms box. Placeholders like `{{TERMS}}` get longer once filled in.

Put the IDs of both templates in Step 5 (`TEMPLATE_ID_EN` and `TEMPLATE_ID_ES`).

---

## Step 5. Create the script (10 min)

1. Go to **script.google.com** and click **New project**. Rename it `Quote Agent`.
2. Open `quote-agent/dist/QuoteAgent.gs` in this repository, copy everything, and paste it over the contents of `Code.gs`.
3. Click the gear icon (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**. Go back to the editor, open `appsscript.json` and replace its contents with `quote-agent/dist/appsscript.json`.
4. In **Project Settings > Script Properties**, add:

| Property | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from Step 1 |
| `RATE_SHEET_ID` | the rate sheet ID |
| `TEMPLATE_ID_EN` | ID of TEMPLATE Quote EN |
| `TEMPLATE_ID_ES` | ID of TEMPLATE Quote ES |

5. Save (Ctrl+S or Cmd+S).

---

## Step 6. Run setup and authorize (3 min)

1. In the editor, choose the function `setup` from the dropdown and click **Run**.
2. Google asks for permissions. Because this is your own private script, Google shows "This app isn't verified". Click **Advanced**, then **Go to Quote Agent (unsafe)**, then **Allow**. The script only runs in your account.
3. `setup` creates:
   - a **Quote Agent Tracker** spreadsheet in your Drive,
   - a **Quote Agent Decks** folder,
   - a Gmail label `quote-agent/quote-request`,
   - a trigger that runs it every 4 hours.

   Already ran `setup` before this update? Paste the new `QuoteAgent.gs` and run `setup` again. It replaces the old trigger.

---

## Step 7. Test on the last 4 weeks (5 min plus your review)

1. Choose `runBackfill` and click **Run**. It looks at the last 28 days. Google stops any run after about 6 minutes, so it works in batches. Open **Execution log**: if it says "Run runBackfill again to continue", click **Run** again until it says "Backfill finished".
2. Open **Quote Agent Tracker**. Each quote request has a row with its type, the totals, the deck link, items it could not price and questions to ask the client.
3. Compare a couple of rows with what you actually sent. Tell me what is off (prices, tone, slides kept, the type it chose) and I will tune it.

From then on it runs every 4 hours on its own. To change that, edit `RUN_EVERY_HOURS` in `CONFIG` and run `setup` again.

---

## Day to day

- **Tracker, Quotes tab:** one row per request. The "Floor check" column is internal only and never goes into a deck.
- **Status values:**
  - `Review deck`: ready for your review.
  - `Review deck: some items need your price`: something had no matching rate (for example a 4 hour shoot). Fill those in by hand.
  - `Ask client for details`: too vague to price. The questions are in "Missing info".
  - `Tender or complex: Pablo quotes`: formal terms of reference or multi-region jobs. You get a summary and draft line items, no deck.
- **Pause it:** in script.google.com, open **Triggers** (the clock icon) and delete the trigger.
- **Reprocess an email:** delete its row in the tracker's **Log** tab. It is picked up again on the next run.
- **Errors:** if Claude or Google fails (no credits left, an outage), the agent retries on the next scheduled runs. After 3 failed tries the email shows up in Quotes as `Error: handle by hand`, so no lead disappears silently.
- **Who bills:** Colombian clients are quoted by Intelygente SAS in COP plus IVA (19%). Everyone else is quoted by Yellow Film Machine LLC in USD. This depends on the client's country, not on the inbox the request arrived at.

## Settings you can change

Everything is at the top of the script in `CONFIG`: inboxes, VAT rate, payment terms, billing entity per inbox, sample categories and models. Prices are always read live from the rate sheet, so updating the sheet is enough.
