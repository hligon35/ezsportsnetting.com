import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve(process.cwd(), 'server/database');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const files = fs.readdirSync(source).filter(name => name.endsWith('.json') && name !== 'schema.json');

console.log('BEGIN TRANSACTION;');
for (const file of files) {
  const collection = path.basename(file, '.json');
  let records;
  try { records = JSON.parse(fs.readFileSync(path.join(source, file), 'utf8')); } catch { continue; }
  if (!Array.isArray(records)) continue;
  for (const record of records) {
    const recordId = record?.id || collection + '_' + Math.random().toString(16).slice(2);
    const createdAt = record?.createdAt || new Date().toISOString();
    const updatedAt = record?.updatedAt || createdAt;
    console.log('INSERT OR REPLACE INTO records (collection,id,data,created_at,updated_at) VALUES (' +
      [collection, recordId, JSON.stringify({ ...record, id: recordId }), createdAt, updatedAt].map(quote).join(',') + ');');
  }
}
console.log('COMMIT;');
