-- Etapa 9 — Aditivos: garantias de integridade identificadas na análise pré-implementação

-- 1. UNIQUE(contract_id, version_number) em contract_additives
--    Impede dois aditivos com o mesmo version_number dentro do mesmo contrato
CREATE UNIQUE INDEX "contract_additives_contract_id_version_number_key"
  ON "contract_additives"("contract_id", "version_number");

-- 2. Índice em contract_additive_services(service_id)
--    Melhora desempenho em consultas por serviço dentro de aditivos
CREATE INDEX "contract_additive_services_service_id_idx"
  ON "contract_additive_services"("service_id");
