---
title: How do I set client fees, hourly costs and the target margin?
section: Admin
audience: admin
keywords: [profitability, profit, margin, target margin, fee, monthly fee, tier default, hourly cost, loaded cost, cost rate, effective from, revenue, effective rate, internal, mgb internal, who sees profit]
sort: 540
---
Profit figures are internal. Only admins the owner has given the **MGB (internal)** permission (**HR › Members**, the **MGB (internal)** column) see them. Other admins and all other staff see no fees, hourly costs, cost, profit or margins anywhere, and can't open this article. Nothing tells them it's hidden.

They combine three things you set up once:

| Input | Where | Default |
|---|---|---|
| Client's monthly fee | Synced from the **MGB_Master_Data** sheet, or Team → click a client → **Profitability** | The fee from the client's confirmed pricing milestone ("tier default") |
| Staff hourly cost | Team → click a person → **Loaded hourly cost** | Not set |
| Target margin | Team → summary strip above the Clients table | 40% |

Hours come from QuickBooks Time.

### How it's calculated

- **Revenue** = monthly fee × months in the period (partial months by days).
- **Cost** = QuickBooks Time hours × each person's loaded hourly cost on the day they worked.
- **Margin** = profit ÷ revenue. The chip is green at or above target, amber up to 15 points below, red below that.

### Set a client's actual fee

1. On **Team**, click the client.
2. In **Profitability**, click **Set actual monthly fee** (or **Change actual monthly fee**), enter the amount and click **Save fee**.
3. To go back to the milestone fee, click **Use tier default** or **Clear actual fee**.

If the fee has a **Master Data** tag, it comes from the sheet: see the next section.

### Fees synced from Master Data

Client fees can come straight from the **MGB_Master_Data** Google Sheet (**Clients** tab, column **Bookkeeping fee 2027**). The portal only reads the sheet; it never writes to it.

- Only rows with Status **Active** set a fee. **Lost**, **Paused** and **Gone** rows never change a fee.
- A blank or non-number fee never clears a fee.
- Sheet names match portal clients exactly (ignoring case, spaces and punctuation) or through a match you saved. Nothing is guessed.
- Test and internal clients are skipped.

**Sync by hand:** on **Team › Hours**, the **Master Data sync** strip sits under the summary strip. Click **Preview changes**, check the list (nothing has changed yet), then **Sync now** and confirm. **Details** shows the last runs.

**Nightly:** after the first **Sync now**, the sync also runs every night (early morning). If a nightly run would change more than 10 fees, or move any fee by more than half, it holds and changes nothing; preview and **Sync now** by hand instead.

**Rows with no portal client:** listed under **Details** › **Sheet rows with no portal client**. Choose the client and click **Match to client**, or click **Not a client**. The match is used from the next sync on.

**One client's fee should differ from the sheet:** a synced fee is read-only on the client's **Profitability** card (change it in the sheet). To use another fee, click **Override (stops Master Data sync for this client)**, enter the fee and click **Save override**. The tag then says **override**. **Resume sync** turns it back on, and the next sync sets the sheet's fee again.

#### One-time setup (owner)

Until this is done the strip says **not connected yet** and nothing changes.

1. In Google Cloud Console, pick or create a project and turn on the **Google Sheets API** (**APIs & Services › Library**).
2. Go to **IAM & Admin › Service accounts › Create service account**. Name it something like `mgb-master-data-reader`. Give it no roles.
3. Open the new account, then **Keys › Add key › Create new key › JSON**. A .json file downloads. Keep it private.
4. In Supabase (MGB Client Portal project), go to **Edge Functions › Secrets** and add a secret named `GOOGLE_SA_KEY`. Paste the whole contents of the .json file as the value. Then delete the file from your computer.
5. In Google Drive, open **MGB_Master_Data › Share** and add the service account's email as **Viewer** (untick **Notify people**). The email is on the service account's page in Google Cloud and in the key file as `client_email`; it ends in `.iam.gserviceaccount.com`. Never use **Publish to web**: that would make the fees public.
6. Back in the portal, open **Team › Hours › Master Data sync › Details**. It now says **Reading as** the service account's email. Click **Preview changes**, check the list, then **Sync now**. The nightly sync starts after this first run.

To read **Bookkeeping fee now** instead of 2027, ask the developer to switch the fee column; the nightly sync then waits for a new **Sync now**.

### Set a staff member's hourly cost

1. On **Team**, click the person.
2. In **Loaded hourly cost** (pay plus taxes and overhead), enter the **Hourly cost** and an **Effective from** date, then **Save rate**.

A new rate starts on its date; hours before it keep the old rate. Rate history is listed below with **Remove** on each row.

### Change the target margin

In the summary strip (Revenue, Cost, Profit, Blended margin), click **Edit** next to **Target margin**, enter 0–100 and **Save**.

### Where else you see it

- **Team › Hours, Clients table**: Fee / mo, **vs milestone** (the actual fee minus the fee for the client's confirmed pricing milestone: plus means they pay more, minus means less; "on milestone" when no actual fee is set so the milestone fee is used), Eff. rate, Cost, Profit and Margin %, plus the **Least profitable first** sort.
- **Team › Hours, click a person**: their **Loaded hourly cost**.
- **Client overview → Billing and time**: monthly fee, cost, profit and margin.
- **Client health**: **Margin below target** takes 15 points off. Only people with the permission have it in their score, so their score for a client can be lower than another admin's.
- **Weekly digest**: the **Price review** and **Revenue snapshot** sections, and the fee and margin bits of the headline, go only to recipients with the permission. Everyone else on the list gets the same digest without them. **Preview** shows you the version you would get.
- **Audit log**: every fee, rate and target change, in the **Client fees**, **Cost rates** and **Profitability settings** groups. Only people with the permission see those entries or groups. Fee changes made by the sync show the actor **master-sheet-sync** and **(Master Data sync)**; overrides and sheet matches are logged there too.

Turning the permission off for an admin hides all of this from them at once, in the database as well as on screen.

### Troubleshooting

- **"Connect QuickBooks Time to see cost and profit. Fees are shown alone."** See [How do I connect the firm's QuickBooks Time?](#/help/firm-quickbooks).
- **"Set staff rates to see profit."** Add a loaded hourly cost for each person with hours.
- **"Cost (part estimated)" or "…couldn't be costed (no rates)."** Someone worked on the client without an hourly cost set for that date.
- **"Profitability isn't set up on the server yet."** A database update is missing. Tell the owner.
- **Master Data sync says "not connected yet".** The one-time setup isn't finished, or the key saved in `GOOGLE_SA_KEY` doesn't work (**Details** says why).
- **"Google says the service account can't open the sheet."** Share MGB_Master_Data with the service account's email as Viewer again.
- **"The sheet or the portal changed since your preview."** Click **Preview changes** again, then **Sync now**.
