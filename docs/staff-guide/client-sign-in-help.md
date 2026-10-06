---
title: How does a client sign in, and what do I tell them if they can't?
section: Getting started
audience: staff
keywords: [client sign in, client login, client can't log in, cannot sign in, sign-in code, code, magic link, sign-in link, one-time link, no email, spam, expired, resend, send a new code, wait seconds, not set up for portal access, deactivated, turned off, wrong person, wrong account, installed app, phone app, login page, invite, script]
sort: 22
---
Clients don't have a password. They sign in with their email address, and we email them a one-time link and a code. Staff sign in with Google instead (see [How do I sign in?](#/help/signing-in)).

### Where clients sign in

**app.mygoodbooks.org/login**. The bare address **app.mygoodbooks.org** shows the same client sign-in page when nobody is signed in. Older links ending in **?client-login=1** still work too.

### How a client signs in

1. On the **Client portal** page, they type their email under **Email address** and click **Email me a sign-in link**.
2. The page changes to **Check your email**: *We sent a sign-in email to {email}. Click the link in it, or type the code from the email below.*
3. The email's subject is *Your MyGoodBooks sign-in code:* followed by the code. It has the code and a **Sign in to MyGoodBooks** button.
4. They either:
   - type the code in **Sign-in code** and click **Sign in**, or
   - click **Sign in to MyGoodBooks** in the email.

**Why there's a code:** the button in the email always opens their web browser. If they started on another device, or in the MyGoodBooks app on their phone or computer, the button signs them in somewhere else. The code signs them in right where they typed their email. Tell them to keep the **Check your email** screen open while they get the code.

The code only works once and expires soon. Only the newest code works.

### Who can sign in

Only people we've added as portal logins for that client (on **Client roster**, see [How do I set up a new client from start to finish?](#/help/new-client-start-to-finish)). Typing any other address doesn't create an account or send an email. The page shows *Couldn't send the email. Check the address and try again.*

A brand-new login gets an invite email first. Its link opens the portal and signs them in. After that they use the sign-in page above.

### Waiting between emails

Only one email can be sent about every minute. If they ask again too soon, they see *Please wait {n} seconds before asking for another email. Your last code still works.*

On the **Check your email** screen:

- **Send a new code** sends another email. They'll see *New code sent. Use the code from the newest email.*
- **Use a different email** goes back to the first screen.

### When a login is turned off

If a login is unticked (**Deactivated**) on **Client roster**, or removed, that person can't get in. If they still have an account, the email still arrives, but after the link or code they see *{email} isn't set up for portal access yet. Ask your bookkeeper.* and a **Sign out and use a different address** button. If they're signed in already, this happens the next time they open the portal.

Clicking **Invite / Resend invite** on their row turns the login back on.

### A message you can send the client

> To sign in to MyGoodBooks, go to app.mygoodbooks.org/login, type your email address and click "Email me a sign-in link". We'll email you a sign-in code and a button. Type the code on the "Check your email" screen and click "Sign in", or click the button in the email. If you're using the MyGoodBooks app, use the code. The code only works once and expires soon, so use the newest email. If nothing arrives within a few minutes, check your spam folder, then let us know which email address you used.

### Troubleshooting

- **No email arrives.**
  1. Ask them to check spam and junk.
  2. Check the address they typed matches their row on **Client roster** exactly.
  3. If they saw *Couldn't send the email. Check the address and try again.*, that address isn't set up. Add them, or check for a typo. People added by **Bulk import** don't get an account until you click **Invite / Resend invite** on their row.
  4. If they asked twice within a minute, the second email wasn't sent. The first code still works.
- **"That code didn't work or has expired. Check it, or send a new one."** The code was mistyped, already used, too old, or not from the newest email. Click **Send a new code** and use the code from the newest email.
- **The link in the email doesn't work or has expired.** Go back to **app.mygoodbooks.org/login** and ask for a new email. Using the code instead of the link usually avoids this.
- **They reloaded the page and the code box is gone.** Type the email again, click **Email me a sign-in link**, and use the code from the new email.
- **"{email} isn't set up for portal access yet. Ask your bookkeeper."** Their login is deactivated, or they used a different address from the one we added. Check **Client roster**. Click **Sign out and use a different address** to try another email.
- **The invite expired, or they never got it.** Click **Invite / Resend invite** on their row. If it says *…already has a sign-in account — they can sign in from the portal login page.*, no email was sent; send them the message above.
- **They're signed in as the wrong person** (for example a shared computer). They open the **Settings** gear, then **Security & privacy**, then **Sign out**, and sign in again with their own email. **Sign out on all devices** is there for a lost or shared computer.
- **"{name}'s account isn't linked to a client MyGoodBooks has set up yet."** Their login points to a client that isn't on the roster. Let an admin know.
- **"Couldn't verify your access. Try again in a moment."** A temporary problem checking their login. Ask them to try again in a minute.
- **You opened the client sign-in yourself and it took you to the staff app.** A @mygoodbooks.org account always goes to the staff side. To test a client login, use a private window. See [How do I sign in?](#/help/signing-in).
