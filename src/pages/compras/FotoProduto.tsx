import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Foto do produto por referência do fornecedor (bucket fotos-produto).
 * Substitui o caminho de rede \\srvfs\...\13. FOTOS MIX do Access.
 */
export function FotoProduto({ refFornecedor }: { refFornecedor: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    setErro(false);
    setUrl(null);
    if (!refFornecedor) return;
    const { data } = supabase.storage.from('fotos-produto').getPublicUrl(`${refFornecedor}.jpg`);
    setUrl(data.publicUrl);
  }, [refFornecedor]);

  if (!refFornecedor) return null;

  return (
    <Card className="fixed bottom-4 right-4 z-40 w-44 shadow-lg">
      <CardContent className="p-2">
        {url && !erro ? (
          <img
            src={url}
            alt={refFornecedor}
            className="h-36 w-full rounded object-contain"
            onError={() => setErro(true)}
          />
        ) : (
          <div className="flex h-36 flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            <span className="text-xs">Sem foto</span>
          </div>
        )}
        <p className="mt-1 truncate text-center text-xs text-muted-foreground">{refFornecedor}</p>
      </CardContent>
    </Card>
  );
}
