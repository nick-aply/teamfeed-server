// aply-server/scripts/export-input-templates.mjs
//
// List all InputTemplates docs. Useful when authoring a pipelines.json for
// import-pipelines.mjs — `templateNames` in that file resolves against the
// `name` field on these docs (case-insensitive).
//
// Usage:
//   node scripts/export-input-templates.mjs
//   node scripts/export-input-templates.mjs --json templates.json

import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
const pkMatch = src.match(/private_key:\s*'([^']+)'/);
if (!pkMatch) throw new Error('Could not find private_key in server.js');

admin.initializeApp({
  credential: admin.credential.cert({
    type: 'service_account',
    project_id: 'mrkt-2efde',
    private_key_id: '9278d3dab0b13eb5720140943d7ffed2996b1a1a',
    private_key: pkMatch[1].replace(/\\n/g, '\n'),
    client_email: 'firebase-adminsdk-18dkb@mrkt-2efde.iam.gserviceaccount.com',
  }),
});
const db = admin.firestore();

const args = process.argv.slice(2);
const flags = { json: null };
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--json') flags.json = args[++i];
}

async function main() {
  const snap = await db.collection('InputTemplates').get();
  const list = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || '',
        category: data.category || '',
        description: data.description || '',
        fields: Array.isArray(data.fields) ? data.fields : [],
        showOnCardFields: Array.isArray(data.showOnCardFields) ? data.showOnCardFields : [],
        published: !!data.published,
        sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
      };
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (list.length === 0) {
    process.stderr.write('No InputTemplates found.\n');
    process.stderr.write('Create some at /input-templates first if you want\n');
    process.stderr.write('your import JSON to reference them by name.\n');
    process.exit(0);
  }

  // stdout: tab-separated id, name, category, field_count, on_card_count, published
  process.stdout.write('# id\tname\tcategory\tfields\tonCard\tpublished\n');
  list.forEach((t) => {
    process.stdout.write(
      `${t.id}\t${t.name}\t${t.category}\t${t.fields.length}\t${t.showOnCardFields.length}\t${t.published}\n`
    );
  });

  process.stderr.write(`\n${list.length} template${list.length === 1 ? '' : 's'} total\n`);

  if (flags.json) {
    fs.writeFileSync(path.resolve(flags.json), JSON.stringify(list, null, 2));
    process.stderr.write(`Wrote JSON: ${flags.json}\n`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
