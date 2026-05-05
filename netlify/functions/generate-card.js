// ============================================================
//  Pulse v0.3.1 — Netlify Function: generate-card
//  Arquivo: netlify/functions/generate-card.js
//
//  Recebe : POST { "input": "texto ou link do usuário" }
//  Retorna: { "card": { ...campos do Pulse... } }
//  Chave  : lida exclusivamente de process.env.GEMINI_API_KEY
// ============================================================

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ── Prompt do sistema — curador do Pulse ────────────────────
const SYSTEM_PROMPT = `Você é o curador do Pulse, um feed pessoal de inteligência do Lucas.

PERFIL DO LUCAS:
- Estudante de Engenharia Elétrica na Unicamp (4º ano).
- Trabalha com processos, qualidade e melhoria contínua no Agibank (fintech de crédito para desbancarizados).
- TCC sobre data centers sustentáveis: foco em energia, refrigeração, PUE, WUE, CUE, impactos territoriais no Brasil e IA.
- Interesses profissionais: engenharia elétrica, energia renovável, dados, machine learning, crédito, fintechs, automação de processos.
- Interesses pessoais: aprender francês (nível B1, meta B2), produtividade prática, desenvolvimento pessoal aplicado.
- Prefere conteúdo técnico, direto, aplicável, com ação clara.
- Evita: motivacional genérico, clickbait, viralidade vazia, conteúdo superficial, anime.

CATEGORIAS DISPONÍVEIS (use exatamente uma):
- TCC: data centers, PUE/WUE/CUE, refrigeração, sustentabilidade energética, IA em infraestrutura
- Carreira: vagas, mercado, fintechs, crédito, processos, qualidade, entrevistas, networking
- Engenharia: energia elétrica, smart grids, renováveis, automação industrial, papers de engenharia
- Tecnologia: ferramentas de software, Python, cloud, DevOps, APIs, produtividade técnica
- Dados: análise, estatística, visualização, SQL, pandas, datasets, notebooks
- Francês: aprendizado de idiomas, recursos, técnicas, vocabulário, cultura francófona
- Vida: organização pessoal, produtividade, hábitos, frameworks práticos, rotina
- Cultura: arte, cinema, leitura, curiosidades técnicas, história da tecnologia (SEM anime)

REGRAS DE RELEVÂNCIA (campo "relevance", número de 0.0 a 10.0):
- 9.0–10.0: impacto direto no TCC ou em decisão de carreira imediata
- 7.0–8.9:  aplicável nos próximos 30 dias
- 5.0–6.9:  interessante mas sem urgência real
- < 5.0:    pouca conexão com os objetivos atuais

REGRAS DE GERAÇÃO:
1. Analise o input (pode ser texto livre, link, ideia, tema ou trecho de artigo).
2. Se for apenas uma URL: infira o tema pelo domínio e path — NÃO invente fatos específicos do artigo; sinalize que o Lucas deve verificar o conteúdo na fonte.
3. Gere um card objetivo, útil e personalizado.
4. Use linguagem clara, direta e em português brasileiro.
5. "suggestedAction": ação concreta realizável hoje ou amanhã, começa com verbo no infinitivo.
6. "whyItMatters": conexão com objetivo real do Lucas, não generalidade.
7. "connection": áreas separadas por " · " (ex: "TCC · dados · Python").
8. "deepDiveContent.applications": exatamente 3 itens, array de strings.
9. "deepDiveContent.steps": exatamente 3 itens, array de strings com passos concretos.
10. "deepDiveContent.expanded": contexto técnico aprofundado, 3–5 frases.
11. "sourceUrl": URL original se o input contiver uma, senão string vazia "".
12. Se o input não tiver conexão clara com os objetivos do Lucas, seja honesto, dê relevância baixa e explique por quê no whyItMatters.

FORMATO DE RESPOSTA:
Responda APENAS com JSON válido. Nenhum texto antes ou depois. Nenhum bloco markdown. Nenhuma explicação fora do JSON. Apenas o objeto abaixo:

{
  "title": "Título claro e informativo, sem clickbait (máximo 100 caracteres)",
  "category": "uma das 8 categorias listadas",
  "relevance": 8.4,
  "summary": "Resumo em 2–3 frases: o que é, o que mostra, qual o dado ou insight principal.",
  "whyItMatters": "Por que isso importa especificamente para o Lucas agora. Seja concreto.",
  "connection": "Área1 · Área2 · Área3",
  "suggestedAction": "Ação específica e realizável. Ex: Baixar o paper X e ler a seção 3 antes da próxima orientação.",
  "sourceUrl": "URL se fornecida, senão string vazia",
  "deepDiveContent": {
    "expanded": "Contexto expandido com detalhes técnicos reais. 3–5 frases.",
    "applications": [
      "Aplicação prática 1 para o contexto do Lucas",
      "Aplicação prática 2",
      "Aplicação prática 3"
    ],
    "steps": [
      "Passo concreto 1 com recurso ou ferramenta específica",
      "Passo concreto 2",
      "Passo concreto 3"
    ]
  }
}`;

// ── Handler principal ────────────────────────────────────────
exports.handler = async function (event) {

  // Preflight CORS (requisições OPTIONS do browser)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  // Só aceita POST
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Método não permitido. Use POST." });
  }

  // Chave da API — lida do ambiente, nunca do frontend
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[Pulse] GEMINI_API_KEY não configurada.");
    return respond(500, {
      error: "Chave de API não configurada. Adicione GEMINI_API_KEY nas variáveis de ambiente do Netlify.",
    });
  }

  // Parse e validação do body
  let userInput = "";
  try {
    const body = JSON.parse(event.body || "{}");
    userInput  = (body.input || "").trim();
  } catch {
    return respond(400, { error: "Body inválido. Envie JSON com o campo 'input'." });
  }

  if (!userInput) {
    return respond(400, { error: "O campo 'input' está vazio." });
  }

  // Limita tamanho do input para evitar abuso
  if (userInput.length > 2000) {
    userInput = userInput.slice(0, 2000) + "…";
  }

  // ── Chamada à Gemini API ──────────────────────────────────
  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",          // rápido, econômico e capaz
      generationConfig: {
        temperature:     0.7,
        topP:            0.9,
        maxOutputTokens: 1200,
        // Força resposta em JSON puro
        responseMimeType: "application/json",
      },
    });

    // Monta o prompt completo concatenando sistema + input
    const fullPrompt = `${SYSTEM_PROMPT}

---
INPUT DO LUCAS:
"${userInput}"

Gere o card do Pulse para este input seguindo todas as regras acima.`;

    const result  = await model.generateContent(fullPrompt);
    const rawText = result.response.text();

    if (!rawText) throw new Error("Resposta vazia do Gemini.");

    // Parse e validação do JSON retornado
    let card;
    try {
      // Remove possíveis blocos markdown caso o modelo ignore responseMimeType
      const clean = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
      card = JSON.parse(clean);
    } catch {
      console.error("[Pulse] JSON inválido recebido do Gemini:", rawText.slice(0, 300));
      throw new Error("O modelo retornou um JSON inválido.");
    }

    // Valida campos obrigatórios
    const required = ["title", "category", "relevance", "summary", "whyItMatters", "connection", "suggestedAction"];
    for (const field of required) {
      if (card[field] === undefined || card[field] === null) {
        throw new Error(`Campo obrigatório ausente na resposta do modelo: "${field}".`);
      }
    }

    // Normaliza e completa o card para o formato exato esperado pelo frontend
    card.relevance      = Math.min(10, Math.max(0, parseFloat(card.relevance) || 7.0));
    card.sourceUrl      = card.sourceUrl || "";
    card.generatedByAI  = true;

    // Garante estrutura completa do deepDiveContent
    if (!card.deepDiveContent || typeof card.deepDiveContent !== "object") {
      card.deepDiveContent = {};
    }
    card.deepDiveContent.expanded = card.deepDiveContent.expanded || card.summary;

    // Garante arrays para applications e steps (Gemini pode retornar strings separadas por | por engano)
    card.deepDiveContent.applications = normalizeArray(card.deepDiveContent.applications, 3);
    card.deepDiveContent.steps        = normalizeArray(card.deepDiveContent.steps, 3);

    // Log de uso (sem dados sensíveis)
    const usage = result.response.usageMetadata;
    console.log(
      `[Pulse] Card gerado via Gemini — categoria: ${card.category} | relevância: ${card.relevance}` +
      (usage ? ` | tokens: ${usage.totalTokenCount}` : "")
    );

    return respond(200, { card });

  } catch (err) {
    console.error("[Pulse] Erro ao chamar Gemini:", err.message);

    // Erros conhecidos da Gemini API
    const msg = err.message || "";

    if (msg.includes("API_KEY_INVALID") || msg.includes("401")) {
      return respond(401, { error: "Chave GEMINI_API_KEY inválida. Verifique a configuração no Netlify." });
    }
    if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate")) {
      return respond(429, { error: "Limite de requisições do Gemini atingido. Tente novamente em alguns instantes." });
    }
    if (msg.includes("SAFETY")) {
      return respond(422, { error: "O conteúdo foi bloqueado pelos filtros de segurança do Gemini. Tente reformular o input." });
    }

    return respond(500, { error: `Erro ao gerar card: ${msg.slice(0, 120)}` });
  }
};

// ── Helpers ──────────────────────────────────────────────────

/**
 * Garante que o valor é um array de strings com pelo menos `min` itens.
 * Aceita: array de strings, string separada por "|", ou string simples.
 */
function normalizeArray(value, min = 3) {
  let arr;
  if (Array.isArray(value)) {
    arr = value.map(String).filter(Boolean);
  } else if (typeof value === "string" && value.includes("|")) {
    arr = value.split("|").map(s => s.trim()).filter(Boolean);
  } else if (typeof value === "string" && value.trim()) {
    arr = [value.trim()];
  } else {
    arr = [];
  }
  // Preenche com placeholder se vier menos itens que o mínimo
  while (arr.length < min) arr.push("Consultar fontes primárias para complementar este ponto.");
  return arr;
}

/** Retorna Response com headers CORS padronizados */
function respond(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function corsHeaders() {
  return {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
  };
}
