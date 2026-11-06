// node --test tests/edge/qbo_webhook.test.mjs
// supabase/functions/qbo-webhook/logic.ts (signature, realm ids) and
// supabase/functions/qbo-sync/webhook_due.ts (who the cron run syncs).
import test from "node:test";
import assert from "node:assert/strict";
import * as W from "../../supabase/functions/qbo-webhook/logic.ts";
import * as D from "../../supabase/functions/qbo-sync/webhook_due.ts";
import { createHmac } from "node:crypto";

const TOKEN = "verifier-token-abc";
const sign = (body, key = TOKEN) => createHmac("sha256", key).update(body).digest("base64");

test("accepts Intuit's signature made with the verifier token", async () => {
  const body = JSON.stringify({ eventNotifications: [{ realmId: "123" }] });
  assert.equal(await W.verifyIntuitSignature(body, sign(body), [TOKEN]), true);
});

test("tries every configured token (production and sandbox apps)", async () => {
  const body = "{}";
  assert.equal(await W.verifyIntuitSignature(body, sign(body, "sandbox-tok"), [undefined, "prod-tok", "sandbox-tok"]), true);
});

test("rejects a wrong, missing or tampered signature, and rejects when no token is set", async () => {
  const body = JSON.stringify({ eventNotifications: [{ realmId: "123" }] });
  assert.equal(await W.verifyIntuitSignature(body, sign(body, "other"), [TOKEN]), false);
  assert.equal(await W.verifyIntuitSignature(body, null, [TOKEN]), false);
  assert.equal(await W.verifyIntuitSignature(body + " ", sign(body), [TOKEN]), false);
  assert.equal(await W.verifyIntuitSignature(body, sign(body), [undefined, "", null]), false);
});

test("reads realm ids from the legacy payload", () => {
  const p = {
    eventNotifications: [
      { realmId: "9130350", dataChangeEvent: { entities: [{ name: "Invoice", id: "5", operation: "Create" }] } },
      { realmId: "9130350" },
      { realmId: "42" },
    ],
  };
  assert.deepEqual(W.realmsFromPayload(p).sort(), ["42", "9130350"]);
});

test("reads realm ids from CloudEvents payloads (array or single)", () => {
  const ev = { specversion: "1.0", id: "x", type: "qbo.invoice.created.v1", intuitaccountid: "777", intuitentityid: "5" };
  assert.deepEqual(W.realmsFromPayload([ev, { ...ev, intuitaccountid: "888" }]).sort(), ["777", "888"]);
  assert.deepEqual(W.realmsFromPayload(ev), ["777"]);
});

test("ignores junk and non-numeric realm ids", () => {
  assert.deepEqual(W.realmsFromPayload(null), []);
  assert.deepEqual(W.realmsFromPayload({ eventNotifications: [{ realmId: "1 or 1=1" }, {}, null] }), []);
  assert.deepEqual(W.realmsFromPayload([{ intuitaccountid: "abc" }, 5]), []);
});

const NOW = new Date("2026-11-06T18:00:00Z");
const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
const ON = { enabled: true, fallbackMin: 360 };
const OFF = { enabled: false, fallbackMin: 360 };

test("off (default): webhooks never decide anything", () => {
  assert.equal(D.webhookDue("premium", { last_synced_at: ago(1), webhook_dirty_at: ago(1) }, NOW, OFF, "normal", 60), null);
});

test("settings: default off, fallback 360, too-small fallback ignored", () => {
  assert.deepEqual(D.webhookSettingsFrom(null), { enabled: false, fallbackMin: 360 });
  assert.deepEqual(D.webhookSettingsFrom({ webhooks_enabled: true, webhook_fallback_min: 720 }), { enabled: true, fallbackMin: 720 });
  assert.deepEqual(D.webhookSettingsFrom({ webhooks_enabled: "true", webhook_fallback_min: 5 }), { enabled: false, fallbackMin: 360 });
});

test("Pro with a webhook mark syncs once the last sync is 5+ minutes old", () => {
  assert.deepEqual(D.webhookDue("premium", { last_synced_at: ago(6), webhook_dirty_at: ago(1) }, NOW, ON, "normal", 60), { due: true, reason: "webhook" });
  assert.deepEqual(D.webhookDue("premium", { last_synced_at: ago(2), webhook_dirty_at: ago(1) }, NOW, ON, "normal", 60), { due: false, reason: "not_due" });
});

test("Pro without a mark waits for the safety-net poll, not the hourly one", () => {
  assert.equal(D.webhookDue("premium", { last_synced_at: ago(90) }, NOW, ON, "normal", 60).due, false);
  assert.deepEqual(D.webhookDue("premium", { last_synced_at: ago(358) }, NOW, ON, "normal", 60), { due: true, reason: "fallback" });
});

test("never synced is always due", () => {
  assert.deepEqual(D.webhookDue("premium", { last_synced_at: null }, NOW, ON, "normal", 60), { due: true, reason: "never" });
});

test("Plus, Basic and a throttled usage guard keep the plan schedule", () => {
  const c = { last_synced_at: ago(10), webhook_dirty_at: ago(1) };
  assert.equal(D.webhookDue("standard", c, NOW, ON, "normal", 60), null);
  assert.equal(D.webhookDue("basic", c, NOW, ON, "normal", 60), null);
  assert.equal(D.webhookDue("premium", c, NOW, ON, "throttled", 120), null);
});
