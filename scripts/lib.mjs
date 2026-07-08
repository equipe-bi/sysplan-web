import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const envPath = path.join(ROOT, '.env.migration');
  if (!existsSync(envPath)) {
    console.error('Arquivo .env.migration não encontrado.');
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
  }
  return env;
}

// Parser de CSV com suporte a aspas, campos multilinha e vazio=null
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  const pushField = () => {
    row.push(fieldWasQuoted ? field : field === '' ? null : field);
    field = '';
    fieldWasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\r') {
      // ignora
    } else if (c === '\n') {
      pushField();
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || fieldWasQuoted || row.length > 0) {
    pushField();
    rows.push(row);
  }
  return rows;
}

export async function restRequest(env, method, pathAndQuery, body, headers = {}) {
  const res = await fetch(`${env.SUPABASE_URL}${pathAndQuery}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${pathAndQuery} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}
