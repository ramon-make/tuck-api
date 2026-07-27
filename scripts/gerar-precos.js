/**
 * Gera precos-atualizado.csv a partir das tabelas de preço em PDF de docs/.
 *
 * Uso:  node scripts/gerar-precos.js
 *
 * O CSV resultante deve ser importado na planilha de preços
 * (Arquivo > Importar > Substituir planilha atual). A API não lê este arquivo
 * diretamente — ela continua lendo a planilha via PRICE_SHEET_ID.
 *
 * Requer o `pdftotext` do **poppler**. O `pdftotext` do Xpdf (que vem junto com o
 * Git para Windows em mingw64/bin) desalinha as colunas destes PDFs e associa
 * preços aos tamanhos errados — por isso o binário é validado antes do uso.
 * Para apontar um binário específico: PDFTOTEXT=/caminho/para/pdftotext
 */

import { execFileSync, spawnSync } from 'child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'fs';
import { join, basename, dirname, delimiter } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = join(ROOT, 'docs');
const OUT_FILE = join(ROOT, 'precos-atualizado.csv');

const PRICE_SHEET_ID = process.env.PRICE_SHEET_ID || '13MFWsX1INiWyj5sLI2Af74Gj8nz27TITVzqBxt-qF0w';
const PRICE_GID = process.env.PRICE_GID || '';
const PRICE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${PRICE_SHEET_ID}/export?format=csv${PRICE_GID ? `&gid=${PRICE_GID}` : ''}`;

// Escolas que continuam vindo da planilha antiga por não terem PDF.
const SEM_PDF = ['ATTIE', 'EMYGDIO'];

// Cada PDF traz o nome da escola como prefixo da descrição do produto.
const PREFIXO_POR_ARQUIVO = {
  'Tabela Amaral': 'AUGUSTO DO AMARAL',
  'Tabela Appez': 'APPEZ',
  'Tabela Bloom Ed. Infantil': 'BLOOM',
  'Tabela Coc': 'COC',
  'Tabela Colégio Bloom': 'COLEGIO BLOOM',
  'Tabela Company': 'COMPANY',
  'Tabela Cri Curumim': 'CRI CURUMIM',
  'Tabela Crideal': 'CRIDEAL',
  'Tabela Cunha Carvalho': 'CUNHA CARVALHO',
  'Tabela Dom Henrique': 'DOM HENRIQUE',
  'Tabela Educativa': 'EDUCATIVA',
  'Tabela Heloisa': 'HELOISA',
  'Tabela Kiddies World': 'KW',
  'Tabela Major Telmo': 'MAJOR TELMO',
  'Tabela Pequenos Girassóis': 'PEQUENOS GIRASSÓIS',
  'Tabela Sementes para o Amanhã': 'SA',
  'Tabela Vidigal': 'VIDIGAL',
};

// Único remap de escola: o PDF usa a sigla, a planilha usa o nome por extenso.
const ESCOLA_RENOMEADA = { KW: 'KIDDIES WORLD' };

// desc | tamanho | valor — o `^\s*` é obrigatório: sem ele as linhas indentadas
// a partir da 3ª página do PDF são descartadas silenciosamente.
const LINHA_RE = /^\s*(?<desc>\S.*?)\s{2,}(?<tam>\S.*?)\s{2,}(?<val>[\d.]+,\d{2})\s*$/;

/**
 * Localiza um pdftotext do poppler.
 *
 * O Xpdf também aceita `-layout`, mas quebra o alinhamento das colunas destes
 * relatórios (o preço de um tamanho acaba colado em outro), então aceitar
 * qualquer `pdftotext` do PATH corromperia a base silenciosamente.
 */
function achaPdftotext() {
  const candidatos = [];
  if (process.env.PDFTOTEXT) candidatos.push(process.env.PDFTOTEXT);

  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const exe of ['pdftotext.exe', 'pdftotext']) {
      const p = join(dir, exe);
      if (existsSync(p)) candidatos.push(p);
    }
  }

  // Instalação via winget (oschwartz10612.Poppler), que não entra no PATH.
  const pacotes = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(pacotes)) {
    for (const pasta of readdirSync(pacotes)) {
      if (!pasta.startsWith('oschwartz10612.Poppler')) continue;
      const base = join(pacotes, pasta);
      for (const versao of readdirSync(base)) {
        const p = join(base, versao, 'Library', 'bin', 'pdftotext.exe');
        if (existsSync(p) && statSync(p).isFile()) candidatos.push(p);
      }
    }
  }

  const rejeitados = [];
  for (const bin of candidatos) {
    // O poppler escreve o banner do `-v` em stderr e o Xpdf em stdout, então os
    // dois fluxos precisam ser lidos — daí spawnSync em vez de execFileSync.
    const r = spawnSync(bin, ['-v'], { encoding: 'utf8' });
    const banner = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (/poppler/i.test(banner)) return bin;
    rejeitados.push(`${bin} (${banner.split('\n')[0]?.trim() || 'desconhecido'})`);
  }

  throw new Error(
    'pdftotext do poppler não encontrado.\n' +
    (rejeitados.length ? `  Binários rejeitados por não serem poppler:\n    ${rejeitados.join('\n    ')}\n` : '') +
    '  Instale com:  winget install oschwartz10612.Poppler\n' +
    '  Ou aponte o binário:  PDFTOTEXT=/caminho/para/pdftotext node scripts/gerar-precos.js'
  );
}

function ehCabecalho(linha) {
  return (
    linha.startsWith('RELATÓRIO DE PRODUTOS') ||
    linha.startsWith('Descrição') ||
    /^\d{2}\/\d{2}\/\d{4}/.test(linha)
  );
}

/** Primeira regra que casar vence — a ordem importa. */
function categoria(produto) {
  const u = produto.toUpperCase();
  if (/BLUS[AÃ]O/.test(u)) return 'AGASALHO';
  if (u.includes('BERMUDA')) return 'BERMUDA';
  if (/CAL[ÇC]A/.test(u)) return 'CALÇA';
  if (u.includes('CAMISETA')) return 'CAMISETA';
  // Antes do fallback: VESTIDO COM SHORTS é SAIA/SHORT, VESTIDO sozinho é OUTROS.
  if (u.includes('SAIA') || u.includes('SHORT')) return 'SAIA/SHORT';
  return 'OUTROS';
}

function normalizaProduto(produto) {
  return produto
    .replace(/^DIVERSOS\s+/i, '')            // "DIVERSOS SHORTS DE MALHA..." já existe sem o prefixo
    .replace(/^(CAL[ÇC]A)\.\s*/i, '$1 ')     // CALÇA.BAILARINA / CALÇA. LEGGING -> CALÇA BAILARINA
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizaTamanho(tamanho) {
  return tamanho
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^0+(?=\d)/, '');               // 06 -> 6, mas "PP ADULTO" fica intacto
}

function extraiLinhasDoPdf(binario, caminhoPdf, dirTmp) {
  const destino = join(dirTmp, basename(caminhoPdf, '.pdf') + '.txt');
  execFileSync(binario, ['-layout', caminhoPdf, destino]);
  return readFileSync(destino, 'utf8').replace(/\f/g, '').split(/\r?\n/);
}

function csvEscape(valor) {
  const s = String(valor ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function lePlanilhaAtual() {
  const res = await fetch(PRICE_SHEET_URL);
  if (!res.ok) throw new Error(`Erro ao buscar planilha de preços: HTTP ${res.status}`);
  const linhas = parse(await res.text(), { relaxQuotes: true, skipEmptyLines: true });
  return linhas
    .slice(1)
    .filter(r => r.length >= 5 && r[2]?.trim())
    .map(r => ({
      escola: r[0].trim(),
      categoria: r[1].trim(),
      produto: r[2].trim(),
      tamanho: r[3].trim(),
      preco: r[4].trim(),
    }));
}

function chave(escola, produto, tamanho) {
  const n = s => s.toUpperCase().replace(/\s+/g, ' ').trim();
  return `${n(escola)}|${n(produto)}|${n(tamanho)}`;
}

function soDigitos(preco) {
  return preco.replace(/[^\d,]/g, '');
}

async function main() {
  const binario = achaPdftotext();
  const dirTmp = mkdtempSync(join(tmpdir(), 'tuck-precos-'));
  const registros = [];
  const sobras = [];
  const suspeitos = [];
  let duplicadas = 0;
  const vistas = new Set();

  try {
    const pdfs = readdirSync(DOCS_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
    console.log(`pdftotext: ${binario}`);
    console.log(`Lendo ${pdfs.length} PDFs de docs/\n`);

    for (const arquivo of pdfs) {
      const nome = basename(arquivo, '.pdf');
      const prefixo = PREFIXO_POR_ARQUIVO[nome];
      if (!prefixo) {
        throw new Error(`PDF sem escola mapeada em PREFIXO_POR_ARQUIVO: "${nome}"`);
      }

      let lidas = 0;
      let naoParseadas = 0;

      for (const linha of extraiLinhasDoPdf(binario, join(DOCS_DIR, arquivo), dirTmp)) {
        if (!linha.trim() || ehCabecalho(linha.trim())) continue;

        const m = LINHA_RE.exec(linha);
        if (!m) {
          naoParseadas++;
          sobras.push(`${nome}: ${linha.trim()}`);
          continue;
        }

        const descOriginal = m.groups.desc.trim();
        const tamOriginal = m.groups.tam.trim();

        const temPrefixo = descOriginal.toUpperCase().startsWith(prefixo + ' ');
        const bruto = temPrefixo ? descOriginal.slice(prefixo.length + 1) : descOriginal;

        const escola = ESCOLA_RENOMEADA[prefixo] ?? prefixo;
        const produto = normalizaProduto(bruto);
        const tamanho = normalizaTamanho(tamOriginal);

        const k = chave(escola, produto, tamanho);
        if (vistas.has(k)) {
          duplicadas++;
          continue;
        }
        vistas.add(k);

        registros.push({
          escola,
          categoria: categoria(produto),
          produto,
          tamanho,
          preco: '$' + m.groups.val,
          origem: `${descOriginal} | ${tamOriginal}`,
        });
        lidas++;
      }

      // Esperado: no máximo 1 descarte por arquivo (o artefato da tarja preta do
      // rodapé). Muito acima disso indica extração desalinhada.
      if (naoParseadas > 1) suspeitos.push(`${nome} (${naoParseadas} descartadas)`);

      console.log(`  ${nome.padEnd(30)} ${String(lidas).padStart(4)} linhas` +
        (naoParseadas ? `  (${naoParseadas} descartada${naoParseadas > 1 ? 's' : ''})` : ''));
    }
  } finally {
    rmSync(dirTmp, { recursive: true, force: true });
  }

  const dosPdfs = registros.length;

  // --- escolas sem PDF: preservadas como estão na planilha atual ---
  console.log('\nLendo a planilha atual...');
  const planilha = await lePlanilhaAtual();
  console.log(`  ${planilha.length} linhas na planilha (${PRICE_SHEET_ID})`);

  for (const r of planilha) {
    if (!SEM_PDF.includes(r.escola.toUpperCase())) continue;
    registros.push({ ...r, origem: 'planilha anterior (sem PDF)' });
  }

  // --- relatório de diferenças ---
  const antes = new Map(planilha.map(r => [chave(r.escola, r.produto, r.tamanho), soDigitos(r.preco)]));
  const depois = new Map(
    registros.filter(r => r.origem !== 'planilha anterior (sem PDF)')
      .map(r => [chave(r.escola, r.produto, r.tamanho), soDigitos(r.preco)])
  );

  const porEscola = new Map();
  const bump = (escola, campo) => {
    if (!porEscola.has(escola)) porEscola.set(escola, { novos: 0, removidos: 0, alterados: 0 });
    porEscola.get(escola)[campo]++;
  };
  const escolasComPdf = new Set(registros.filter(r => r.origem !== 'planilha anterior (sem PDF)').map(r => r.escola));

  for (const [k, preco] of depois) {
    const escola = k.split('|')[0];
    if (!antes.has(k)) bump(escola, 'novos');
    else if (antes.get(k) !== preco) bump(escola, 'alterados');
  }
  for (const k of antes.keys()) {
    const escola = k.split('|')[0];
    if (escolasComPdf.has(escola) && !depois.has(k)) bump(escola, 'removidos');
  }

  console.log('\n--- diferenças vs. planilha atual ---');
  for (const escola of [...porEscola.keys()].sort()) {
    const d = porEscola.get(escola);
    console.log(`  ${escola.padEnd(22)} novos=${String(d.novos).padStart(3)}  removidos=${String(d.removidos).padStart(3)}  preço alterado=${String(d.alterados).padStart(3)}`);
  }

  // --- grava o CSV ---
  const cabecalho = ['Escola', 'Categoria', 'Produto', 'Tamanho', 'Preço', 'Origem'];
  const linhasCsv = [cabecalho.join(',')];
  for (const r of registros) {
    linhasCsv.push([r.escola, r.categoria, r.produto, r.tamanho, r.preco, r.origem].map(csvEscape).join(','));
  }
  writeFileSync(OUT_FILE, '﻿' + linhasCsv.join('\n') + '\n', 'utf8');

  const porCategoria = {};
  for (const r of registros) porCategoria[r.categoria] = (porCategoria[r.categoria] || 0) + 1;
  const semCategoria = registros.filter(r => !r.categoria).length;

  console.log('\n--- resultado ---');
  console.log(`  ${dosPdfs} linhas dos PDFs + ${registros.length - dosPdfs} de escolas sem PDF (${SEM_PDF.join(', ')})`);
  console.log(`  TOTAL: ${registros.length} linhas, ${new Set(registros.map(r => r.escola)).size} escolas`);
  console.log(`  duplicadas removidas: ${duplicadas} | sem categoria: ${semCategoria}`);
  console.log(`  categorias: ${Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  console.log(`  linhas descartadas: ${sobras.length} (esperado: 1 por PDF, o artefato do rodapé)`);

  if (suspeitos.length) {
    console.log(`\n  ATENÇÃO: extração possivelmente desalinhada em: ${suspeitos.join(', ')}`);
    console.log('  Confira o binário do pdftotext antes de importar — o CSV pode estar com preços trocados.');
  }

  console.log(`\nCSV gravado em ${OUT_FILE}`);
  console.log('Importe na planilha: Arquivo > Importar > Substituir planilha atual.');
}

main().catch(err => {
  console.error('[ERRO]', err.message);
  process.exit(1);
});
