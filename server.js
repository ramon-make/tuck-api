import express from 'express';
import { parse } from 'csv-parse/sync';

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const SHEET_ID = process.env.SHEET_ID || '1FPkWfkWJPW0zf-tyoA_mjMVfXBcnSSy1WvFFJ7XZeQ4';
const GID = process.env.GID || '1088220793';
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '60', 10) * 1000;

const PRICE_SHEET_ID = process.env.PRICE_SHEET_ID || '13MFWsX1INiWyj5sLI2Af74Gj8nz27TITVzqBxt-qF0w';
const PRICE_GID = process.env.PRICE_GID || '';

if (!API_KEY) {
  console.warn('[AVISO] API_KEY não definida — endpoints desprotegidos. Defina a variável de ambiente antes de ir para produção.');
}

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
const PRICE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${PRICE_SHEET_ID}/export?format=csv${PRICE_GID ? `&gid=${PRICE_GID}` : ''}`;

let cache = { data: null, fetchedAt: 0 };
let priceCache = { data: null, fetchedAt: 0 };

function parsePtBrNumber(str) {
  if (!str || typeof str !== 'string') return 0;
  const cleaned = str.trim().replace(/\./g, '').replace(',', '.');
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

function parsePtBrPrice(str) {
  if (!str || typeof str !== 'string') return 0;
  const cleaned = str.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

function formatPrice(num) {
  return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalize(str) {
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

async function fetchSheet() {
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`Erro ao buscar planilha: HTTP ${res.status}`);
  const text = await res.text();

  const rows = parse(text, { relaxQuotes: true, skipEmptyLines: true });

  // Encontra a linha do cabeçalho (a que contém COD_PRODUTO)
  const headerIdx = rows.findIndex(r => r.some(c => c.trim() === 'COD_PRODUTO'));
  if (headerIdx === -1) throw new Error('Cabeçalho COD_PRODUTO não encontrado na planilha');

  const headers = rows[headerIdx].map(h => h.trim().toLowerCase());
  const idxCod = headers.indexOf('cod_produto');
  const idxGrade = headers.indexOf('cod_grade');
  const idxDesc = headers.indexOf('desc_produto');
  const idxEst = headers.indexOf('estoque');

  const data = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const cod = r[idxCod]?.trim();
    if (!cod) continue;

    const grade = r[idxGrade]?.trim() ?? '';
    const desc = r[idxDesc]?.trim() ?? '';
    const estoque = r[idxEst]?.trim() ?? '0';

    // Filtra linha de total/lixo
    if (grade === '*' || desc === '-') continue;

    const codNum = parseInt(cod, 10);
    if (isNaN(codNum)) continue;

    data.push({
      cod_produto: codNum,
      cod_grade: grade,
      desc_produto: desc,
      estoque,
      estoque_num: parsePtBrNumber(estoque),
    });
  }

  return data;
}

async function getData() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL) {
    return cache.data;
  }
  try {
    const data = await fetchSheet();
    cache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    if (cache.data) {
      console.error('[ERRO] Falha ao atualizar cache, servindo dados antigos:', err.message);
      return cache.data;
    }
    throw err;
  }
}

async function fetchPriceSheet() {
  const res = await fetch(PRICE_SHEET_URL);
  if (!res.ok) throw new Error(`Erro ao buscar planilha de preços: HTTP ${res.status}`);
  const text = await res.text();

  const rows = parse(text, { relaxQuotes: true, skipEmptyLines: true });

  // Encontra a linha do cabeçalho (a que contém PRODUTO e PREÇO)
  const headerIdx = rows.findIndex(r => {
    const cols = r.map(c => normalize(c));
    return cols.includes('produto') && cols.includes('preco');
  });
  if (headerIdx === -1) throw new Error('Cabeçalho (Produto/Preço) não encontrado na planilha de preços');

  const headers = rows[headerIdx].map(h => normalize(h));
  const idxEscola = headers.indexOf('escola');
  const idxCat = headers.indexOf('categoria');
  const idxProd = headers.indexOf('produto');
  const idxTam = headers.indexOf('tamanho');
  const idxPreco = headers.indexOf('preco');

  const data = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const produto = r[idxProd]?.trim();
    if (!produto) continue;

    const preco_num = parsePtBrPrice(r[idxPreco]?.trim() ?? '');
    data.push({
      escola: r[idxEscola]?.trim() ?? '',
      categoria: idxCat !== -1 ? (r[idxCat]?.trim() ?? '') : '',
      produto,
      tamanho: r[idxTam]?.trim() ?? '',
      preco: formatPrice(preco_num),
      preco_num,
    });
  }

  return data;
}

async function getPriceData() {
  const now = Date.now();
  if (priceCache.data && now - priceCache.fetchedAt < CACHE_TTL) {
    return priceCache.data;
  }
  try {
    const data = await fetchPriceSheet();
    priceCache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    if (priceCache.data) {
      console.error('[ERRO] Falha ao atualizar cache de preços, servindo dados antigos:', err.message);
      return priceCache.data;
    }
    throw err;
  }
}

function authMiddleware(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

const app = express();

app.get('/health', async (_req, res) => {
  try {
    const data = await getData();
    const precos = await getPriceData();
    const cacheAge = Math.floor((Date.now() - cache.fetchedAt) / 1000);
    res.json({ status: 'ok', total_itens: data.length, total_precos: precos.length, cache_age_s: cacheAge });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

app.get('/produtos', authMiddleware, async (req, res) => {
  try {
    let data = await getData();

    const { cod_produto, grade, q, com_estoque, limit, offset } = req.query;

    if (cod_produto) {
      const cod = parseInt(cod_produto, 10);
      data = data.filter(d => d.cod_produto === cod);
    }
    if (grade) {
      const g = grade.toLowerCase();
      data = data.filter(d => d.cod_grade.toLowerCase() === g);
    }
    if (q) {
      const term = q.toLowerCase();
      data = data.filter(d => d.desc_produto.toLowerCase().includes(term));
    }
    if (com_estoque === 'true') {
      data = data.filter(d => d.estoque_num > 0);
    }

    const total = data.length;
    const off = parseInt(offset || '0', 10);
    const lim = limit ? parseInt(limit, 10) : undefined;
    const items = lim ? data.slice(off, off + lim) : data.slice(off);

    res.json({ total, count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/precos', authMiddleware, async (req, res) => {
  try {
    let data = await getPriceData();

    const { escola, categoria, tamanho, produto, q, limit, offset } = req.query;

    if (escola) {
      const e = normalize(escola);
      data = data.filter(d => normalize(d.escola) === e);
    }
    if (categoria) {
      const c = normalize(categoria);
      data = data.filter(d => normalize(d.categoria) === c);
    }
    if (tamanho) {
      const t = normalize(tamanho);
      data = data.filter(d => normalize(d.tamanho) === t);
    }
    if (produto) {
      const p = normalize(produto);
      data = data.filter(d => normalize(d.produto) === p);
    }
    if (q) {
      const term = normalize(q);
      data = data.filter(d => normalize(d.produto).includes(term));
    }

    const total = data.length;
    const off = parseInt(offset || '0', 10);
    const lim = limit ? parseInt(limit, 10) : undefined;
    const items = lim ? data.slice(off, off + lim) : data.slice(off);

    res.json({ total, count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/resumo', authMiddleware, async (req, res) => {
  try {
    let data = await getData();

    const { cod_produto, com_estoque } = req.query;

    if (cod_produto) {
      const cod = parseInt(cod_produto, 10);
      data = data.filter(d => d.cod_produto === cod);
    }

    // Agrupa por cod_produto
    const mapaEstoque = {};
    for (const item of data) {
      const k = item.cod_produto;
      if (!mapaEstoque[k]) {
        mapaEstoque[k] = {
          cod_produto: k,
          desc_produto: item.desc_produto,
          grades: [],
          estoque_total: 0,
        };
      }
      mapaEstoque[k].grades.push({ cod_grade: item.cod_grade, estoque: item.estoque, estoque_num: item.estoque_num });
      mapaEstoque[k].estoque_total += item.estoque_num;
    }

    let resumo = Object.values(mapaEstoque);

    if (com_estoque === 'true') {
      resumo = resumo.filter(r => r.estoque_total > 0);
    }

    const total_geral = resumo.reduce((acc, r) => acc + r.estoque_total, 0);

    res.json({ total_produtos: resumo.length, total_geral, items: resumo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`tuck-api rodando na porta ${PORT}`);
});
