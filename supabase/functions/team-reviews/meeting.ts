// Email to the team member when both reviews are in but the comparison is not
// revealed yet (team-reviews-7). The reviewer reveals it in the review meeting,
// so this only asks them to set up the meeting. No scores, no answers, and it
// never says the results are ready.
export function bothCompleteEmail(
  p: { cycle?: string; reviewer_name?: string },
  reviewerName: string | null | undefined,
  reviewHref: string,
): { subject: string; lines: string[]; cta: string; href: string } {
  const cycle = p.cycle || "this quarter";
  const rev = String(reviewerName || p.reviewer_name || "").trim().split(/\s+/)[0] || "your reviewer";
  return {
    subject: `Both sides of your ${cycle} review are in`,
    lines: [
      `Both you and ${rev} have submitted your ${cycle} review.`,
      `Next step: set up a time with ${rev} to go over it together. You'll see the comparison together in that meeting.`,
    ],
    cta: "Open my review",
    href: reviewHref,
  };
}
