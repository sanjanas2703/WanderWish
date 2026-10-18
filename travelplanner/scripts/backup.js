#!/usr/bin/env node
// Backup of the MongoDB database as one JSON file (Extended JSON, so dates and numbers round-trip exactly).
// Safe while the app is running. Keeps the newest BACKUP_KEEP copies.
//   npm run backup
//   npm run restore -- backups/wanderwish-<timestamp>.json    (stop the app first; replaces everything)
import "../server/env.js";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, close, models } from "../server/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { EJSON } = mongoose.mongo.BSON;
const FORMAT = "wanderwish-backup";

// Uses the app's connection when there is one (tests), otherwise opens and closes its own.
async function withDb(fn) {
  const own = mongoose.connection.readyState !== 1;
  if (own) await connect();
  try { return await fn(); } finally { if (own) await close(); }
}

export async function runBackup({ dir = process.env.BACKUP_DIR || path.join(root, "backups"), keep = Number(process.env.BACKUP_KEEP || 14) } = {}) {
  return withDb(async () => {
    const collections = {};
    for (const m of Object.values(models)) collections[m.collection.collectionName] = await m.find().sort({ _id: 1 }).lean();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = path.join(dir, `wanderwish-${stamp}.json`);
    fs.writeFileSync(dest, EJSON.stringify({ format: FORMAT, version: 1, createdAt: new Date(), collections }, { relaxed: false }));
    // Read the file back to make sure it is complete before pruning older copies.
    const check = EJSON.parse(fs.readFileSync(dest, "utf8"));
    for (const [name, docs] of Object.entries(collections)) {
      if (check.collections?.[name]?.length !== docs.length) throw new Error(`Backup failed its check (${name})`);
    }
    const old = fs.readdirSync(dir).filter(f => /^wanderwish-.*\.json$/.test(f)).sort().reverse().slice(keep);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
    return dest;
  });
}

// Replaces every collection with the backup's contents.
export async function runRestore(file) {
  const data = EJSON.parse(fs.readFileSync(file, "utf8"));
  if (data.format !== FORMAT) throw new Error(`${file} is not a WanderWish backup`);
  return withDb(async () => {
    let n = 0;
    for (const m of Object.values(models)) {
      const docs = data.collections[m.collection.collectionName] || [];
      await m.deleteMany({});
      if (docs.length) await m.collection.insertMany(docs); // raw insert: documents go back exactly as saved
      n += docs.length;
    }
    return n;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--restore");
  const job = i >= 0
    ? (process.argv[i + 1] ? runRestore(process.argv[i + 1]).then(n => `Restored ${n} documents from ${process.argv[i + 1]}`) : Promise.reject(new Error("Usage: npm run restore -- <backup file>")))
    : runBackup().then(p => "Backup written: " + path.relative(process.cwd(), p));
  job.then(msg => console.log(msg)).catch(e => { console.error(e.message); process.exit(1); });
}
