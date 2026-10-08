---
title: How does Team › Performance score bookkeepers?
section: Admin
audience: staff
keywords: [performance, score, rank, ranking, bookkeeper performance, scorecard, where they stand, reply time, month-end, close on time, client health, tasks, deadlines, hours, capacity, quarterly review, weights, how it's scored]
sort: 548
---
**Team › Performance** gives every bookkeeper a score from 0 to 100 so you can see where they stand without guessing. Admins see everyone, ranked. Bookkeepers see their own score and the inputs behind it, never the ranking.

### What goes into the score

Six signals, each a percentage for the last 30 or 90 days (switch at the top right of the card):

- **Replies within goal (25%)** — share of client replies sent inside the firm's reply-time goal. Same numbers as **Team › Reply times**.
- **Month-ends closed on time (25%)** — months whose late day fell in the period, closed (done or N/A) by that day. The late day is set in **Work › Close**.
- **Health of assigned clients (20%)** — the average client health score across their assigned clients, with the number of red clients shown.
- **Tasks and deadlines (15%)** — tasks finished plus filings made on time, over those plus overdue tasks.
- **Hours vs capacity (10%)** — how close logged hours (QuickBooks Time, otherwise time entries) came to their weekly target times the weeks in the period. 100 means right on target; over and under both cost points.
- **Latest quarterly review (5%)** — the manager's total from their most recent signed review, out of 30.

The score is the **weighted average of the signals that have data**. A signal with nothing to measure (no month-ends due yet, no review yet) is left out rather than counted as zero, and shows as "no data".

### Reading it

- Click **Details** on a row to see each signal, its weight and the numbers behind it.
- **80 and up** shows green, **60 to 79** gold, **under 60** red.
- A bookkeeper with no assigned clients has no score until work starts.
- Treat a score as a conversation starter, not a verdict. Open the details and look at the inputs before acting on it, and pair it with the quarterly review.

### Changing the weights

The weights live in the database function `staff_performance` (in `supabase/staff-celebrations-performance.sql`) and can be overridden per call. There is no settings screen for them yet.
