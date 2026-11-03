// node --test tests/edge/client_emails_lost.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLostClient } from "../../supabase/functions/client-emails/lost.ts";

test("lost once lost_at is today or earlier", () => {
  assert.equal(isLostClient("2026-10-30", "2026-11-03"), true);
  assert.equal(isLostClient("2026-11-03", "2026-11-03"), true);
  assert.equal(isLostClient("2026-11-04", "2026-11-03"), false);
  assert.equal(isLostClient("2026-11-03T00:00:00Z", "2026-11-03"), true);
});
test("not lost when lost_at is empty", () => {
  assert.equal(isLostClient(null, "2026-11-03"), false);
  assert.equal(isLostClient(undefined, "2026-11-03"), false);
  assert.equal(isLostClient("", "2026-11-03"), false);
});
test("gate checks it and both cron client lists select lost_at", () => {
  const src = readFileSync(new URL("../../supabase/functions/client-emails/index.ts", import.meta.url), "utf8");
  assert.match(src, /isLostClient\(client\?\.lost_at, dateIn\(new Date\(\)\)\)\) return "Lost client"/);
  assert.equal((src.match(/is_internal, lost_at, assigned_bookkeeper/g) || []).length, 2);
});
