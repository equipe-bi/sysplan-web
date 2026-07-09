// Remove linhas duplicadas das tabelas sem chave natural (importação executada 2x)
import { loadEnv, restRequest } from './lib.mjs';

const env = loadEnv();
const TABELAS = ['ext_fup_comex', 'ext_fup_despachante', 'prm_cor_pi', 'prm_depara_campos_pi'];

for (const tabela of TABELAS) {
  const linhas = [];
  let offset = 0;
  while (true) {
    const page = await restRequest(env, 'GET', `/rest/v1/${tabela}?select=*&order=id.asc&offset=${offset}&limit=1000`);
    linhas.push(...page);
    if (page.length === 0) break;
    offset += page.length;
  }
  const vistos = new Set();
  const excluir = [];
  for (const l of linhas) {
    const { id, ...resto } = l;
    const chave = JSON.stringify(resto);
    if (vistos.has(chave)) excluir.push(id);
    else vistos.add(chave);
  }
  for (let i = 0; i < excluir.length; i += 200) {
    const ids = excluir.slice(i, i + 200).join(',');
    await restRequest(env, 'DELETE', `/rest/v1/${tabela}?id=in.(${ids})`, undefined, { Prefer: 'return=minimal' });
  }
  console.log(`${tabela}: ${linhas.length} linhas, ${excluir.length} duplicadas removidas`);
}
console.log('Dedupe concluído.');
