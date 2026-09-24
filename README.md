# jgianini-backend

Sistema de Medicao e Pagamento — Jgianini Esquadrias de Aluminio

---

## Stack

- Node.js >= 20
- Express 4
- JavaScript
- PostgreSQL
- Prisma ORM

## Pré-requisitos

- Node.js >= 20.0.0
- npm >= 10
- PostgreSQL rodando e acessível

## Instalação

```bash
npm install
```

## Configuração

Copie o arquivo de exemplo e preencha as variáveis:

```bash
copy .env.example .env
```

Edite o `.env` com as credenciais reais do banco:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
```

## Execução

Desenvolvimento (com hot-reload):

```bash
npm run dev
```

Produção:

```bash
npm start
```

## Health check

```
GET http://localhost:3000/api/health
```

Resposta esperada:

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

## Banco de dados

Gerar client Prisma após alterar o schema:

```bash
npm run db:generate
```

Executar migrations:

```bash
npm run db:migrate
```

## Estrutura

```
jgianini-backend/
│
├── src/
│   ├── config/          # Configuração de ambiente e Prisma
│   ├── middlewares/     # Error handler, not found
│   ├── modules/         # Módulos de negócio (a partir da Etapa 2)
│   ├── app.js           # Configuração do Express
│   └── server.js        # Inicialização do servidor
│
├── prisma/
│   ├── schema.prisma    # Schema do banco
│   └── migrations/      # Histórico de migrations
│
├── tests/               # Testes
├── .env                 # Variáveis locais (não versionado)
├── .env.example         # Template das variáveis
└── .gitignore
```

## Documentação

Os documentos de referência do sistema estão em:

```
../SISTEMA DE MEDICAO/
  DOCUMENTO 1 — MESTRE DO SISTEMA.txt
  DOCUMENTO 2 — TECNICO DE ARQUITETURA.txt
  DOCUMENTO 3 — TECNICO DE BANCO DE DADOS.txt
  DOCUMENTO 4 — TECNICO DE APIs.txt
  DOCUMENTO 5 — MATRIZ DE PERMISSOES.txt
  DOCUMENTO 6 — DOCUMENTO TECNICO DE FLUXOS.txt
  DOCUMENTO 7 — DOCUMENTO TECNICO DE CALCULOS.txt
```
