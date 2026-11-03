# Site forms

The backend for forms on the public marketing site (mygoodbooks.org). The site
(repo `~/Desktop/MGB Website`, `build/site_static/js/forms.js`) posts each
`<form data-site-form="...">` as JSON to the `site-forms` edge function:

```json
{ "form": "clarity-review", "page": "/clarity", "fields": { "name": "...", "email": "...", "org": "...", "org_type": "...", "role": "...", "budget": "..." } }
```

The function saves the submission in the portal database and emails the
team. The site shows its thank-you panel on any 2xx answer.

Files: `supabase/site-forms.sql` (tables and policies),
`supabase/functions/site-forms/index.ts` (wiring), `logic.ts` (every check and
the email), `tests/edge/site_forms.test.mjs`.

## Tables

- `site_form_submissions`: one row per accepted submission: `form`, `page`,
  `fields` (everything sent, as JSON), `name`, `email`, `status`
  (`new`, `contacted`, `done`, `spam`), `email_sent`, `email_error`,
  `ip_hash` (salted SHA-256; the raw IP is never kept), `user_agent`. Only the
  function writes rows. Active admins can read them and change `status`.
- `site_form_recipients`: who gets the email (`email`, `active`, `note`).
  Admins only. Seeded with holden@mygoodbooks.org (primary) and
  admin@mygoodbooks.org. If the table is empty or can't be read, the email
  goes to holden@mygoodbooks.org.

## What the function checks

It is public (no sign-in), so these are the gate:

- Allowed forms: `clarity-review` (the Free Financial Clarity Review) and
  `contact`.
- CORS answers only `https://mygoodbooks.org`, `https://www.mygoodbooks.org`,
  staging `https://mgb-website-mu.vercel.app` and `http://localhost:8431`. A
  browser on any other site gets 403. A call with no `Origin` (curl) is allowed.
- POST with JSON only, body 10 KB at most. At most 20 fields, all strings, each
  cut to 2000 characters. A real-looking name and a valid email are required.
- A filled `website` field (the hidden honeypot) gets 200 and nothing is saved.
- At most 5 submissions per hour and 20 per day from one IP (429 after that).
- Once the row is saved, the answer is always 200, even if the email fails.
  The failure is kept in `email_error`. If saving fails, the answer is 500.

The email subject reads `New Clarity Review request: <Name>`, and reply-to is
the visitor, so hitting Reply answers them. No confirmation email goes to the
visitor.

## Deploy

1. Apply `supabase/site-forms.sql` (SQL editor or MCP `apply_migration`).
2. Optional: set the secret `SITE_FORMS_SALT` to a long random string
   (Supabase > Edge Functions > Secrets). Without it a fixed salt is used.
   `RESEND_API_KEY` and `DIGEST_FROM` already exist.
3. Deploy. `--no-verify-jwt` is required, because visitors have no login:

   ```sh
   npx --yes supabase@latest functions deploy site-forms --project-ref xumsqmhccgfjnlmieqyu --no-verify-jwt
   ```

4. On the site, set `SITE_FORMS_URL` in `js/site-config.js` to
   `https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/site-forms`.

## Add or turn off a recipient

```sql
insert into public.site_form_recipients (email, note)
values ('someone@mygoodbooks.org', 'why they get these')
on conflict (email) do update set active = true;

update public.site_form_recipients set active = false where email = 'someone@mygoodbooks.org';
```

Use lowercase addresses (the table checks this).

## Test with curl

```sh
curl -i -X POST https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/site-forms \
  -H 'Content-Type: application/json' -H 'Origin: https://mgb-website-mu.vercel.app' \
  -d '{"form":"clarity-review","page":"/clarity","fields":{"name":"Test Person","email":"you@mygoodbooks.org","org":"Test Church"}}'
```

You should get `200 {"ok":true}`, a new row and an email. Then mark the test row as spam
(see below). Five test sends in an hour from one network hits the rate limit.

Local tests: `node --test tests/edge/site_forms.test.mjs`.

## Mark submissions handled

There is no portal screen yet. Read and update in the SQL editor:

```sql
select created_at, form, name, email, fields, status, email_sent, email_error
from public.site_form_submissions order by created_at desc limit 50;

update public.site_form_submissions set status = 'contacted' where id = '<id>';
-- 'done' when finished, 'spam' for junk
```

The id is printed at the bottom of each email.
