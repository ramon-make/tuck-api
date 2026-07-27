# tuck-api

API simples que expõe em JSON o conteúdo da planilha de estoque do Google Sheets, para ser consumida pelo nó **HTTP Request** do n8n.

## Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/health` | Não | Status e total de itens em cache |
| GET | `/produtos` | Sim | Lista com filtros |
| GET | `/precos` | Sim | Tabela de preços (planilha separada) |
| GET | `/resumo` | Sim | Estoque agregado por produto |

### `/produtos` — query params

| Param | Exemplo | Descrição |
|-------|---------|-----------|
| `cod_produto` | `2` | Filtra por código exato |
| `grade` | `M` | Filtra por grade/tamanho (case-insensitive) |
| `q` | `camiseta` | Busca substring na descrição |
| `com_estoque` | `true` | Apenas itens com estoque_num > 0 |
| `limit` | `20` | Nº de itens por página |
| `offset` | `40` | Deslocamento para paginação |

### `/precos` — query params

Lê uma **planilha separada** de preços (`Escola, Categoria, Produto, Tamanho, Preço`). É independente do estoque — não há código em comum entre as duas planilhas, por isso é uma rota dedicada.

Base atual: **3.085 linhas, 19 escolas** (tabelas de 21/07/2026).

| Param | Exemplo | Descrição |
|-------|---------|-----------|
| `escola` | `CRIDEAL` | Filtra por escola (exato, case-insensitive) |
| `categoria` | `CAMISETA` | Filtra por categoria (exato, case-insensitive) |
| `tamanho` | `M` | Filtra por tamanho (exato, case-insensitive) |
| `produto` | `BERMUDA CICLISTA` | Filtra por produto exato (case-insensitive) |
| `q` | `bermuda` | Busca substring no nome do produto |
| `limit` | `20` | Nº de itens por página |
| `offset` | `40` | Deslocamento para paginação |

**Escolas:** APPEZ, ATTIE, AUGUSTO DO AMARAL, BLOOM, COC, COLEGIO BLOOM, COMPANY, CRI CURUMIM, CRIDEAL, CUNHA CARVALHO, DOM HENRIQUE, EDUCATIVA, EMYGDIO, HELOISA, KIDDIES WORLD, MAJOR TELMO, PEQUENOS GIRASSÓIS, SA, VIDIGAL.

**Categorias:** `AGASALHO`, `BERMUDA`, `CALÇA`, `CAMISETA`, `OUTROS`, `SAIA/SHORT`.

**Tamanhos:** numéricos (`1`, `2`, `4`, `6`, `8`, `10`, `12`, `14`), letras (`PP`, `P`, `M`, `G`, `GG`, `EXG`) e compostos, que precisam ser passados por inteiro — `PP ADULTO`, `M INFANTIL`, `EXG ADULTO` etc. (na URL: `?tamanho=PP%20ADULTO`).

### Exemplo de resposta `/precos?q=bermuda&limit=2`

```json
{
  "total": 3085,
  "count": 2,
  "items": [
    {
      "escola": "CUNHA CARVALHO",
      "categoria": "BERMUDA",
      "produto": "BERMUDA CICLISTA",
      "tamanho": "6",
      "preco": "R$ 55,90",
      "preco_num": 55.9
    }
  ]
}
```

### Atualizar a base de preços

A fonte de verdade são as tabelas em PDF de `docs/` (uma por escola). Quando chegarem PDFs novos:

```bash
node scripts/gerar-precos.js
```

O script extrai os PDFs, deriva a categoria pelo nome do produto, preserva as escolas que não têm PDF (ATTIE e EMYGDIO, lidas da própria planilha), grava `precos-atualizado.csv` e imprime um relatório de diferenças (itens novos, removidos e preços alterados).

Depois é só importar na planilha: **Arquivo → Importar → Enviar `precos-atualizado.csv` → Substituir planilha atual**. Em até `CACHE_TTL` (60s) a API já serve os dados novos, sem redeploy.

> **Requer o `pdftotext` do [poppler](https://poppler.freedesktop.org/)** (`winget install oschwartz10612.Poppler`). O `pdftotext` do Xpdf — que vem junto com o Git para Windows em `mingw64/bin` e costuma vir antes no `PATH` — aceita o mesmo `-layout` mas desalinha as colunas destes relatórios, associando preços aos tamanhos errados. Por isso o script valida o binário antes de usar e recusa qualquer um que não seja poppler. Para apontar um caminho específico: `PDFTOTEXT=/caminho/para/pdftotext node scripts/gerar-precos.js`.

### `/resumo` — query params

| Param | Exemplo | Descrição |
|-------|---------|-----------|
| `cod_produto` | `2` | Filtra um produto específico |
| `com_estoque` | `true` | Oculta produtos com estoque zerado |

### Exemplo de resposta `/produtos?cod_produto=2`

```json
{
  "total": 8,
  "count": 8,
  "items": [
    {
      "cod_produto": 2,
      "cod_grade": "1",
      "desc_produto": "CRIDEAL CAMISETA M.C.LARANJA",
      "estoque": "5.000",
      "estoque_num": 5000
    }
  ]
}
```

---

## Rodar localmente

```bash
npm install
cp .env.example .env   # edite a API_KEY
API_KEY=teste npm start
```

Teste:
```bash
curl localhost:3000/health
curl -H "x-api-key: teste" "localhost:3000/produtos?cod_produto=2"
curl -H "x-api-key: teste" "localhost:3000/produtos?com_estoque=true&limit=5"
curl -H "x-api-key: teste" "localhost:3000/precos?q=bermuda&limit=5"
curl -H "x-api-key: teste" "localhost:3000/resumo?cod_produto=2"
```

---

## Deploy no Render

### Opção 1 — Blueprint (render.yaml, 1 clique)

1. Suba o projeto num repositório GitHub/GitLab.
2. No painel do Render: **New + → Blueprint** → aponte para o repositório.
3. O Render lê o `render.yaml` e cria o serviço automaticamente, gerando uma `API_KEY` aleatória.
4. Após o deploy, vá em **Environment** para ver o valor da `API_KEY`.

### Opção 2 — Web Service manual

1. **New + → Web Service** → conecte o repositório.
2. Configurações:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. Em **Environment**, adicione as variáveis do `.env.example` (especialmente `API_KEY`).

> **Atenção:** O plano free do Render "dorme" após 15 min de inatividade. A **primeira chamada** após inatividade pode levar ~30 segundos. Para uso frequente no n8n isso normalmente não é problema.

---

## Configuração no n8n (nó HTTP Request)

1. **Method:** `GET`
2. **URL:** `https://<seu-app>.onrender.com/produtos`
3. **Headers:**
   - Nome: `x-api-key`
   - Valor: `{{ $env.TUCK_API_KEY }}` (ou cole direto a chave)
4. **Query Parameters** (exemplos):
   - `com_estoque=true`
   - `cod_produto=2`

Para o `/resumo`:
- URL: `https://<seu-app>.onrender.com/resumo?com_estoque=true`

A resposta já vem em JSON, pronta para usar nos nós seguintes do fluxo.
