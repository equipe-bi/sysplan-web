import { supabase } from '@/lib/supabase';

/**
 * Banco de imagens (Cloudinary) para fotos de produto.
 * Uploads são feitos direto do navegador via preset NÃO-ASSINADO — o API Secret
 * nunca entra no frontend. Cloud name e preset são informações públicas.
 */
const CLOUD_NAME = (import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string) || 'r1dihzpf';
const UPLOAD_PRESET = (import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string) || 'sysplan-fotos';

/** Aplica otimização automática de formato e qualidade na entrega */
export function otimizarUrl(url: string): string {
  return url.replace('/image/upload/', '/image/upload/f_auto,q_auto/');
}

/** Versão miniatura (largura 120px) para previews em listas */
export function miniaturaUrl(url: string): string {
  return url.replace(/\/image\/upload\/(f_auto,q_auto\/)?/, '/image/upload/f_auto,q_auto,w_120/');
}

/** Envia uma imagem ao Cloudinary e retorna a URL segura */
export async function uploadImagem(arquivo: Blob | File): Promise<string> {
  const form = new FormData();
  form.append('file', arquivo);
  form.append('upload_preset', UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const detalhe = await res.text();
    throw new Error(`Falha no upload da imagem (HTTP ${res.status}): ${detalhe.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.secure_url as string;
}

/**
 * Envia a foto do produto e registra a URL no mapeamento ref → foto,
 * usado pela lista de compras e pelos formulários.
 */
export async function salvarFotoProduto(refFornecedor: string, arquivo: Blob | File): Promise<string> {
  const url = await uploadImagem(arquivo);
  const { error } = await supabase
    .from('fotos_produto')
    .upsert({ cd_ref_fornecedor: refFornecedor, url, atualizado_em: new Date().toISOString() });
  if (error) throw error;
  return url;
}

/** Busca a URL da foto de um produto (Cloudinary); null se não houver */
export async function buscarFotoProduto(refFornecedor: string): Promise<string | null> {
  const { data } = await supabase
    .from('fotos_produto')
    .select('url')
    .eq('cd_ref_fornecedor', refFornecedor)
    .maybeSingle();
  return data?.url ? otimizarUrl(data.url) : null;
}
