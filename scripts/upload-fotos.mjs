// Subida em massa das fotos de produto (pasta de rede -> Cloudinary) com
// mapeamento ref -> URL gravado em fotos_produto no Supabase.
// Uso: node scripts/upload-fotos.mjs ["Z:\caminho\da\pasta"]
//  - nome do arquivo (sem extensão) = referência do fornecedor
//  - upload assinado com public_id fixo (re-execuções não duplicam)
//  - imagens são normalizadas na entrada: máx 1600px, jpg (arquivos gigantes ok)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadEnv, restRequest } from './lib.mjs';

const env = loadEnv();
const CLOUD = env.CLOUDINARY_CLOUD_NAME;
const KEY = env.CLOUDINARY_API_KEY;
const SECRET = env.CLOUDINARY_API_SECRET;
if (!CLOUD || !KEY || !SECRET) {
  console.error('Defina CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET em .env.migration');
  process.exit(1);
}

const PASTA = process.argv[2] ?? 'Z:\\Produtos\\PRODUTO\\13. FOTOS MIX\\NAY -MIX';
const EXTENSOES = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp']);

function assinar(params) {
  const ordenado = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(ordenado + SECRET).digest('hex');
}

async function uploadAssinado(arquivo, publicId) {
  const buf = readFileSync(arquivo);
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder: 'fotos-produto',
    format: 'jpg',
    overwrite: 'true',
    public_id: publicId,
    timestamp: String(timestamp),
    transformation: 'c_limit,w_1600,h_1600',
  };
  const form = new FormData();
  form.append('file', new Blob([buf]));
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append('api_key', KEY);
  form.append('signature', assinar(params));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json.secure_url;
}

// Refs já mapeadas (para re-execução incremental)
const existentes = new Set();
for (let offset = 0; ; offset += 1000) {
  const page = await restRequest(env, 'GET', `/rest/v1/fotos_produto?select=cd_ref_fornecedor&order=cd_ref_fornecedor&offset=${offset}&limit=1000`);
  for (const p of page) existentes.add(p.cd_ref_fornecedor);
  if (page.length < 1000) break;
}
console.log(`Refs já no banco de imagens: ${existentes.size}`);

const arquivos = readdirSync(PASTA)
  .filter((n) => EXTENSOES.has(path.extname(n).toLowerCase()))
  .map((n) => ({
    nome: n,
    ref: path.basename(n, path.extname(n)).trim(),
    caminho: path.join(PASTA, n),
  }))
  .filter((a) => a.ref && !existentes.has(a.ref));

// uma foto por ref: se houver duplicata de nome (ex.: .jpg e .png), fica a primeira
const porRef = new Map();
for (const a of arquivos) if (!porRef.has(a.ref)) porRef.set(a.ref, a);
const fila = [...porRef.values()];
console.log(`Arquivos a subir: ${fila.length} (de ${arquivos.length} candidatos)`);

let ok = 0;
let falhas = 0;
const erros = [];
const pendentesUpsert = [];

async function processa(item) {
  try {
    if (statSync(item.caminho).size < 100) throw new Error('arquivo vazio');
    const publicId = item.ref.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    const url = await uploadAssinado(item.caminho, publicId);
    pendentesUpsert.push({ cd_ref_fornecedor: item.ref, url });
    ok++;
  } catch (e) {
    falhas++;
    erros.push(`${item.nome}: ${e.message}`);
  }
  if ((ok + falhas) % 100 === 0) {
    console.log(`progresso: ${ok + falhas}/${fila.length} (ok=${ok} falhas=${falhas})`);
    await gravarPendentes();
  }
}

async function gravarPendentes() {
  if (pendentesUpsert.length === 0) return;
  const lote = pendentesUpsert.splice(0, pendentesUpsert.length);
  await restRequest(env, 'POST', '/rest/v1/fotos_produto?on_conflict=cd_ref_fornecedor', lote, {
    Prefer: 'return=minimal,resolution=merge-duplicates',
  });
}

const CONCORRENCIA = 5;
for (let i = 0; i < fila.length; i += CONCORRENCIA) {
  await Promise.all(fila.slice(i, i + CONCORRENCIA).map(processa));
}
await gravarPendentes();

console.log(`\nConcluído: ${ok} foto(s) subidas, ${falhas} falha(s).`);
if (erros.length > 0) {
  console.log('Falhas (primeiras 30):');
  erros.slice(0, 30).forEach((e) => console.log('  ' + e));
}
