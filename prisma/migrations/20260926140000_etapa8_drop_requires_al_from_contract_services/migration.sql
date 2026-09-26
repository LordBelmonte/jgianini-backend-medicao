-- Etapa 8 — Correção: remover requires_al de contract_services
-- Motivo: campo não previsto no Doc3 §17; requires_al pertence a services, não a contract_services.
ALTER TABLE "contract_services" DROP COLUMN IF EXISTS "requires_al";