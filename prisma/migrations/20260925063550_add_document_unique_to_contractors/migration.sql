-- Migration: add_document_unique_to_contractors
-- P-04 A: document é opcional (nullable), mas único quando informado.
-- O PostgreSQL permite múltiplos valores NULL em colunas UNIQUE — comportamento correto.

-- Remover índice comum existente (@@index([document]) do schema anterior)
DROP INDEX IF EXISTS "contractors_document_idx";

-- Criar constraint de unicidade (permite múltiplos NULL, bloqueia valores duplicados)
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_document_key" UNIQUE ("document");
