#!/usr/bin/env node
// Client org profile: one-time anniversary import, DRY RUN from the command line.
//
//   node scripts/op-import-dry-run.js <sheet.csv> <clients.json> [--today YYYY-MM-DD]
//
// <sheet.csv>     the owner's sheet exported as CSV (Customer Name, Email,
//                 Anniversary, Address). Keep it OUTSIDE the repo.
// <clients.json>  an array of {id, name} for the portal's clients, e.g. from
//                 `select id, name from clients` saved as JSON. Also outside the repo.
//
// It prints COUNTS ONLY (no names, emails or addresses) and writes nothing:
// no database, no files. The per-row lists are in the portal, under
// Team › Client gifts › Import dry run, where nothing is saved either.
// The real import waits for owner approval.
"use strict";
const fs = require("fs");
const path = require("path");
const I = require(path.join(__dirname, "../components/client/OP_importLogic.js"));

function main(argv) {
  const args = argv.slice(2);
  let today;
  const ti = args.indexOf("--today");
  if (ti !== -1) {
    today = args[ti + 1];
    args.splice(ti, 2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today || "")) {
      console.error("--today must be YYYY-MM-DD");
      return 2;
    }
  }
  if (args.length !== 2) {
    console.error("Usage: node scripts/op-import-dry-run.js <sheet.csv> <clients.json> [--today YYYY-MM-DD]");
    return 2;
  }
  let csv;
  let clients;
  try {
    csv = fs.readFileSync(args[0], "utf8");
  } catch (e) {
    console.error("Could not read the CSV file.");
    return 1;
  }
  try {
    clients = JSON.parse(fs.readFileSync(args[1], "utf8"));
  } catch (e) {
    console.error("Could not read the clients file as JSON.");
    return 1;
  }
  if (!Array.isArray(clients)) {
    console.error("The clients file must be a JSON array of {id, name}.");
    return 1;
  }
  const res = I.dryRun(csv, clients, today ? { today } : {});
  console.log("Client org profile import: DRY RUN (nothing saved). Counts only.");
  console.log(I.countsReport(res));
  return 0;
}

process.exitCode = main(process.argv);
