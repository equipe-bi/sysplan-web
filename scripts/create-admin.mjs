// Cria o usuário administrador inicial (Supabase Auth + perfil admin)
// Uso: npm run create-admin  (usa ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NOME de .env.migration)
import { loadEnv, restRequest } from './lib.mjs';

const env = loadEnv();
const email = process.env.ADMIN_EMAIL || env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD;
const nome = process.env.ADMIN_NOME || env.ADMIN_NOME || 'Administrador';

if (!email || !password) {
  console.error('Defina ADMIN_EMAIL e ADMIN_PASSWORD em .env.migration');
  process.exit(1);
}

let userId;
try {
  const user = await restRequest(env, 'POST', '/auth/v1/admin/users', {
    email,
    password,
    email_confirm: true,
    user_metadata: { nome, perfil: 'admin' },
  });
  userId = user.id;
  console.log(`Usuário Auth criado: ${email} (${userId})`);
} catch (e) {
  if (String(e.message).includes('already') || String(e.message).includes('422')) {
    const list = await restRequest(env, 'GET', `/auth/v1/admin/users?page=1&per_page=100`);
    const found = (list.users ?? list).find((u) => u.email === email);
    if (!found) throw e;
    userId = found.id;
    console.log(`Usuário Auth já existia: ${email} (${userId})`);
  } else {
    throw e;
  }
}

// Garante perfil admin no cadastro da aplicação
await restRequest(env, 'POST', '/rest/v1/usuarios?on_conflict=id', [{
  id: userId, email, nome, perfil: 'admin', bloqueado: false,
}], { Prefer: 'return=minimal,resolution=merge-duplicates' });

console.log('Perfil administrador configurado com sucesso.');
console.log(`\nLogin: ${email}`);
