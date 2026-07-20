import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageOff, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { buscarFotoProduto, salvarFotoProduto } from '@/lib/cloudinary';
import { comprimirImagem, salvarCopiaLocal } from '@/lib/imagem';
import { Button } from '@/components/ui/button';
import { confirmar } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';

/**
 * Foto do produto por referência do fornecedor.
 * Fonte principal: banco de imagens (Cloudinary, mapeado em fotos_produto);
 * fallback: bucket legado do Supabase Storage.
 */
export function useFotoProduto(refFornecedor: string | null) {
  return useQuery({
    queryKey: ['foto_produto', refFornecedor],
    enabled: !!refFornecedor,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const cloudinary = await buscarFotoProduto(refFornecedor!).catch(() => null);
      if (cloudinary) return cloudinary;
      return supabase.storage.from('fotos-produto').getPublicUrl(`${refFornecedor}.jpg`).data.publicUrl;
    },
  });
}

export function Imagem({
  url,
  refFornecedor,
  altura,
  className,
}: {
  url: string | null | undefined;
  refFornecedor: string;
  altura: number;
  className?: string;
}) {
  const [erro, setErro] = useState(false);
  // sem isto, um erro de imagem anterior "trava" o componente e as fotos
  // seguintes não aparecem (o estado de erro não era limpo ao trocar de linha)
  useEffect(() => setErro(false), [url]);
  if (!url || erro) {
    return (
      <div
        className={cn('flex w-full flex-col items-center justify-center gap-1 rounded-md border text-muted-foreground', className)}
        style={{ height: altura }}
      >
        <ImageOff className="h-5 w-5" />
        <span className="text-[10px]">Sem foto</span>
      </div>
    );
  }
  return (
    <img
      key={url}
      src={url}
      alt={refFornecedor}
      className={cn('w-full rounded-md border object-contain', className)}
      style={{ maxHeight: altura }}
      onError={() => setErro(true)}
    />
  );
}

export function FotoInline({
  refFornecedor,
  altura = 160,
  permitirUpload = false,
  deferir = false,
  onPendenteChange,
}: {
  refFornecedor: string | null;
  altura?: number;
  permitirUpload?: boolean;
  /** Quando true, selecionar a foto apenas a "prepara" — o envio ao Cloudinary
   *  ocorre quando o formulário-pai salvar (via commitFotoPendente). */
  deferir?: boolean;
  /** Notifica o pai do arquivo pendente (ou null quando limpo) */
  onPendenteChange?: (file: File | null) => void;
}) {
  const { data: url } = useFotoProduto(refFornecedor);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [pendente, setPendente] = useState<File | null>(null);
  const [previewPendente, setPreviewPendente] = useState<string | null>(null);

  const temFoto = !!url || !!previewPendente;

  // limpa a foto pendente quando a referência muda (troca de linha) e libera o objectURL
  useEffect(() => {
    setPendente(null);
    setPreviewPendente((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
    onPendenteChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refFornecedor]);

  // envio imediato (modo antigo, usado quando deferir=false)
  const enviarImediato = async (file: File) => {
    if (!refFornecedor) {
      toast.error('Informe a Ref. Fornecedor antes de enviar a foto.');
      return;
    }
    setEnviando(true);
    try {
      const comprimida = await comprimirImagem(file, 300 * 1024);
      const gravou = await salvarCopiaLocal(`${refFornecedor}.jpg`, comprimida).catch(() => false);
      await salvarFotoProduto(refFornecedor, comprimida);
      const kb = Math.round(comprimida.size / 1024);
      toast.success(`Foto salva (${kb} KB) no banco de imagens${gravou ? ' e cópia local gravada' : ''}.`);
      qc.invalidateQueries({ queryKey: ['foto_produto', refFornecedor] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setEnviando(false);
    }
  };

  const selecionar = (file: File) => {
    if (!refFornecedor) {
      toast.error('Informe a Ref. Fornecedor antes de escolher a foto.');
      return;
    }
    if (deferir) {
      // apenas prepara: mostra preview e avisa o pai (envio ocorre ao salvar)
      setPreviewPendente((p) => {
        if (p) URL.revokeObjectURL(p);
        return URL.createObjectURL(file);
      });
      setPendente(file);
      onPendenteChange?.(file);
    } else {
      enviarImediato(file);
    }
  };

  const excluir = async () => {
    // se há uma foto apenas preparada, cancela a preparação
    if (pendente) {
      setPendente(null);
      setPreviewPendente((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      onPendenteChange?.(null);
      return;
    }
    if (!refFornecedor) return;
    if (!(await confirmar({ titulo: 'Excluir foto', mensagem: 'Excluir a foto deste produto?', variante: 'destructive', textoConfirmar: 'Excluir' }))) return;
    setExcluindo(true);
    try {
      const { error } = await supabase.from('fotos_produto').delete().eq('cd_ref_fornecedor', refFornecedor);
      if (error) throw error;
      await supabase.storage.from('fotos-produto').remove([`${refFornecedor}.jpg`]).catch(() => {});
      toast.success('Foto excluída.');
      qc.invalidateQueries({ queryKey: ['foto_produto', refFornecedor] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <div className="space-y-1">
      <Imagem url={previewPendente ?? url} refFornecedor={refFornecedor ?? ''} altura={altura} />
      {pendente && (
        <p className="text-center text-[10px] font-medium text-primary">Foto será enviada ao salvar</p>
      )}
      {permitirUpload && (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 text-xs"
            loading={enviando}
            disabled={!refFornecedor}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3 w-3" /> {temFoto ? 'Substituir' : 'Incluir foto'}
          </Button>
          {temFoto && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs text-destructive"
              loading={excluindo}
              onClick={excluir}
              title={pendente ? 'Cancelar foto' : 'Excluir foto'}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) selecionar(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Miniatura para o cabeçalho da lista (linha selecionada) */
export function FotoCabecalho({ refFornecedor }: { refFornecedor: string | null }) {
  const { data: url } = useFotoProduto(refFornecedor);
  if (!refFornecedor) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 shadow-sm">
      <Imagem url={url} refFornecedor={refFornecedor} altura={56} className="w-20" />
      <span className="max-w-28 truncate text-xs text-muted-foreground" title={refFornecedor}>
        {refFornecedor}
      </span>
    </div>
  );
}
