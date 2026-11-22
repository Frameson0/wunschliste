// Legt die D1-Datenbank "wichteln" an, falls es sie noch nicht gibt,
// und trägt ihre ID in worker/wrangler.toml ein. Läuft im GitHub-Workflow.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const NAME = 'wichteln';
const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'worker');
const run = (cmd) => execSync(cmd, { cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function findDb() {
  const out = run('npx wrangler d1 list --json');
  // Warnungen wie "▲ [WARNING] …" überspringen: das JSON beginnt mit "[" gefolgt von "{" oder "]"
  const m = out.match(/\[\s*(\{|\])/);
  if (!m) throw new Error(`Unerwartete Ausgabe von wrangler d1 list:\n${out}`);
  const list = JSON.parse(out.slice(m.index));
  return list.find((db) => db.name === NAME);
}

let db = findDb();
if (!db) {
  console.log(`Datenbank "${NAME}" gibt es noch nicht – wird angelegt.`);
  run(`npx wrangler d1 create ${NAME} --location weur`);
  db = findDb();
}
if (!db || !db.uuid) {
  console.error('Die Datenbank konnte nicht angelegt oder gefunden werden.');
  process.exit(1);
}

const tomlPath = join(workerDir, 'wrangler.toml');
const toml = readFileSync(tomlPath, 'utf8').replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${db.uuid}"`);
writeFileSync(tomlPath, toml);
console.log(`Datenbank "${NAME}" ist bereit (${db.uuid}).`);
