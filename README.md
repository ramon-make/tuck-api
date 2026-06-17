# tuck-api

API simples que expõe em JSON o conteúdo da planilha de estoque do Google Sheets, para ser consumida pelo nó **HTTP Request** do n8n.

## Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/health` | Não | Status e total de itens em cache |
| GET | `/produtos` | Sim | Lista com filtros |
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
