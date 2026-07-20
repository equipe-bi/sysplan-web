/**
 * Utilitários de imagem para fotos de produto.
 * - `comprimirImagem`: reduz a foto para no máximo `maxBytes` (padrão 300 KB) antes
 *   de subir ao Cloudinary, economizando o espaço limitado do plano.
 * - `salvarCopiaLocal`: grava uma cópia local do arquivo, pedindo ao usuário para
 *   escolher a pasta (File System Access API; com fallback para download comum).
 */

const LIMITE_PADRAO = 300 * 1024; // 300 KB

/**
 * Reencoda a imagem como JPEG reduzindo qualidade e, se necessário, dimensão,
 * até ficar abaixo de `maxBytes`. Devolve sempre um Blob JPEG.
 */
export async function comprimirImagem(arquivo: File | Blob, maxBytes = LIMITE_PADRAO): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo);
  const LADO_MAX = 1600; // fotos de produto não precisam de mais que isso
  let largura = bitmap.width;
  let altura = bitmap.height;
  if (Math.max(largura, altura) > LADO_MAX) {
    const escala = LADO_MAX / Math.max(largura, altura);
    largura = Math.round(largura * escala);
    altura = Math.round(altura * escala);
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    throw new Error('Não foi possível processar a imagem neste navegador.');
  }

  let qualidade = 0.9;
  let blob: Blob | null = null;
  // reduz a qualidade progressivamente; quando chega no piso, reduz a dimensão
  for (let tentativa = 0; tentativa < 14; tentativa++) {
    canvas.width = largura;
    canvas.height = altura;
    ctx.clearRect(0, 0, largura, altura);
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', qualidade));
    if (blob && blob.size <= maxBytes) break;
    if (qualidade > 0.42) {
      qualidade -= 0.12;
    } else {
      largura = Math.round(largura * 0.85);
      altura = Math.round(altura * 0.85);
      qualidade = 0.7;
      if (largura < 200) break; // não degrada além do razoável
    }
  }
  bitmap.close?.();
  if (!blob) throw new Error('Não foi possível comprimir a imagem.');
  return blob;
}

export function suportaSeletorPasta(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

/**
 * Abre o explorer para o usuário escolher a pasta onde a cópia será salva.
 * DEVE ser chamado dentro do gesto do usuário (clique), antes de qualquer await
 * longo, senão o navegador bloqueia a abertura do seletor.
 * Retorna o handle da pasta, ou null se o usuário cancelou ou o navegador não suporta.
 */
export async function pedirPastaLocal(): Promise<any | null> {
  const w = window as any;
  if (typeof w.showDirectoryPicker !== 'function') return null;
  try {
    return await w.showDirectoryPicker({ id: 'sysplan-fotos', mode: 'readwrite' });
  } catch (e: any) {
    if (e?.name === 'AbortError') return null; // usuário fechou o seletor
    return null;
  }
}

/**
 * Grava o blob na pasta escolhida (`dirHandle`). Se não houver pasta (navegador
 * sem suporte ou usuário cancelou), dispara um download comum como fallback.
 */
export async function gravarArquivoLocal(dirHandle: any | null, nomeArquivo: string, blob: Blob): Promise<boolean> {
  if (dirHandle) {
    try {
      const handle = await dirHandle.getFileHandle(nomeArquivo, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch {
      // cai no fallback
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Salva uma cópia local do blob em uma única chamada (pede a pasta e grava).
 * Use quando a chamada já ocorre dentro do gesto do usuário.
 */
export async function salvarCopiaLocal(nomeArquivo: string, blob: Blob): Promise<boolean> {
  const dir = await pedirPastaLocal();
  return gravarArquivoLocal(dir, nomeArquivo, blob);
}
