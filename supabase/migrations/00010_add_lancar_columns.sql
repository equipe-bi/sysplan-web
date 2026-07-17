-- 00010_add_lancar_columns.sql
-- Add columns to persist manual 'lancar' flag and responsible person for acompanhamento_importacoes

ALTER TABLE public.acompanhamento_importacoes
  ADD COLUMN IF NOT EXISTS lancar boolean DEFAULT false;

ALTER TABLE public.acompanhamento_importacoes
  ADD COLUMN IF NOT EXISTS responsavel_lancamento text;

-- Optionally ensure an index for quick lookup by lancar (helpful for queries)
CREATE INDEX IF NOT EXISTS idx_acomp_lancar ON public.acompanhamento_importacoes (lancar);
