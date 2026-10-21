// Email to the reviewer when the team member submits their self-review first.
// Blind rule: names the person and the cycle only. No scores, no answers.
export function selfSubmittedEmail(
  p: { cycle?: string; staff_name?: string; due_at?: string | null },
  managerSubmitted: boolean,
  reviewHref: string,
  fmtDue: (d: string | null | undefined) => string,
): { subject: string; lines: string[]; cta: string; href: string } | null {
  // The reviewer finished before this was sent: comparison_ready covers it.
  if (managerSubmitted) return null;
  const cycle = p.cycle || "this quarter";
  const who = p.staff_name || "A team member";
  const whoFirst = p.staff_name ? String(p.staff_name).trim().split(/\s+/)[0] + " sees" : "They see";
  return {
    subject: `${who} submitted their ${cycle} self-review`,
    lines: [
      `${who} submitted their self-review for ${cycle}. Your review of them is still open${p.due_at ? `, due ${fmtDue(p.due_at)}` : ""}.`,
      `Complete your side when you can. Once it's in, the comparison opens for you to prep. ${whoFirst} it when you reveal it in the review meeting.`,
    ],
    cta: "Open the review",
    href: reviewHref,
  };
}
