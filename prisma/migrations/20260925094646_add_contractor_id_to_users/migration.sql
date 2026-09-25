-- Migration: add_contractor_id_to_users
-- Relação 1:N: 1 empreiteiro → N usuários; 1 usuário → 0..1 empreiteiro
-- Nullable: usuários internos (Admin, Fiscal, etc.) ficam com contractor_id = NULL

-- Adicionar coluna nullable
ALTER TABLE "users" ADD COLUMN "contractor_id" TEXT;

-- Chave estrangeira com ON DELETE SET NULL
-- Protege contra remoção física de empreiteiro (que o sistema evita, mas como fallback)
ALTER TABLE "users" ADD CONSTRAINT "users_contractor_id_fkey"
  FOREIGN KEY ("contractor_id")
  REFERENCES "contractors"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Índice para buscas por contractor_id (listar usuários de um empreiteiro)
CREATE INDEX "users_contractor_id_idx" ON "users"("contractor_id");
