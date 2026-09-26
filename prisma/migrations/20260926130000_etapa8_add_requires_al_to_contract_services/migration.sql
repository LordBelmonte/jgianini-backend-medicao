-- Etapa 8: adicionar requires_al em contract_services
ALTER TABLE "contract_services" ADD COLUMN "requires_al" BOOLEAN NOT NULL DEFAULT false;