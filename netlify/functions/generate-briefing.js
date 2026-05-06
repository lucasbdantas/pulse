// ============================================================
//  Pulse v0.4 — Netlify Function: generate-briefing
//  Arquivo: netlify/functions/generate-briefing.js
//
//  Gera um briefing diário personalizado para o Lucas com
//  exatamente 5 cards balanceados por categoria.
//
//  Recebe : POST { } (sem body obrigatório)
//  Retorna: { "briefing": { date, headline, focus, cards[] } }
// ============================================================

const { GoogleGenerativeAI } = require("@google/generative-ai");

const BRIEFING_PROMPT = `Você é o curador do Pulse, gerando o Daily Intelligence Briefing para o Lucas.

PERFIL DO LUCAS:
- Estudante de Engenharia Elétrica na Unicamp (4º ano).
- Trabalha com processos, qualidade e melhoria contínua no Agibank (fintech de crédito).
- TCC sobre data centers sustentáveis: PUE, WUE, CUE, refrigeração, impactos territoriais no Brasil, IA.
- Interesses: engenharia elétrica, energia renovável, dados, ML, crédito, fintechs, automação.
- Aprendendo francês (B1 → B2). Gosta de produtividade prática.
- Prefere conteúdo técnico, aplicável e direto. Evita motivacional raso e clickbait.

CATEGORIAS: TCC | Carreira | Engenharia | Dados | Tecnologia | Francês | Vida | Cultura

REGRAS OBRIGATÓRIAS PARA O BRIEFING:
1. Gere EXATAMENTE 5 cards.
2. Distribuição obrigatória:
   - Card 1: TCC (sempre)
   - Card 2: Carreira (sempre)
   - Card 3: Engenharia, Dados ou Tecnologia (variar a cada dia)
   - Card 4: Francês ou Vida (variar)
   - Card 5: categoria livre com alta relevância para o Lucas
3. Cada card deve ter uma ação concreta realizável hoje.
4. NÃO invente notícias atuais como fatos reais. Trabalhe com conhecimento técnico consolidado, boas práticas, frameworks, técnicas e sugestões de estudo/projeto.
5. "priority": "Alta" para TCC/Carreira urgente, "Média" para estudo/projeto, "Baixa" para exploração.
6. "estimatedTime": tempo realista para executar a ação sugerida.
7. Relevância (0-10): rigorosa. 9+ apenas se impacto direto em objetivo imediato.
8. Linguagem direta, em português brasileiro, sem floreio.
9. O headline deve ser uma frase de orientação para o dia, não motivacional genérico.
10. O focus deve ser o tema mais importante para o Lucas hoje, em 1 frase.

RESPONDA APENAS COM JSON VÁLIDO. Sem markdown. Sem texto fora do JSON:

{
  "date": "YYYY-MM-DD",
  "headline": "Frase de orientação direta para o dia do Lucas",
  "focus": "Um foco claro para hoje em 1 frase",
  "cards": [
    {
      "title": "Título claro (máx 100 chars)",
      "category": "TCC",
      "priority": "Alta",
      "estimatedTime": "30 min",
      "relevance": 9.2,
      "summary": "O que é e qual o insight principal. 2-3 frases.",
      "whyItMatters": "Por que isso importa AGORA para o Lucas especificamente.",
      "connection": "TCC · PUE · energia",
      "suggestedAction": "Verbo no infinitivo + ação concreta e realizável hoje.",
      "sourceUrl": "",
      "generatedByAI": true,
      "fromBriefing": true,
      "deepDiveContent": {
        "expanded": "Contexto técnico aprofundado. 3-5 frases.",
        "applications": ["Aplicação 1", "Aplicação 2", "Aplicação 3"],
        "steps": ["Passo 1", "Passo 2", "Passo 3"]
      }
    }
  ]
}`;

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[Pulse/Briefing] GEMINI_API_KEY não configurada.");
    return respond(500, { error: "Chave GEMINI_API_KEY não configurada no servidor." });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 6000,
        responseMimeType: "application/json",
      },
    });

    const prompt = `${BRIEFING_PROMPT}

DATA DE HOJE: ${today}
Gere o briefing completo para esta data. Varie os temas e ações em relação a briefings anteriores.`;

    const result  = await model.generateContent(prompt);
    const rawText = result.response.text();
    if (!rawText) throw new Error("Resposta vazia do Gemini.");

    let briefing;
    try {
      const clean = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      briefing = JSON.parse(clean);
    } catch {
      console.error("[Pulse/Briefing] JSON inválido:", rawText.slice(0, 400));
      throw new Error("Gemini retornou JSON inválido.");
    }

    // Valida e normaliza
    if (!briefing.cards || !Array.isArray(briefing.cards)) throw new Error("Campo 'cards' ausente.");
    if (briefing.cards.length !== 5) {
      console.warn(`[Pulse/Briefing] Esperados 5 cards, recebidos ${briefing.cards.length}.`);
    }

    briefing.date     = briefing.date || today;
    briefing.headline = briefing.headline || "Foco e progresso para hoje.";
    briefing.focus    = briefing.focus    || "Avance no que mais importa.";

    briefing.cards = briefing.cards.map((card, i) => ({
      ...card,
      id:            Date.now() + i,
      relevance:     Math.min(10, Math.max(0, parseFloat(card.relevance) || 7.5)),
      status:        "active",
      generatedByAI: true,
      fromBriefing:  true,
      createdAt:     new Date().toISOString(),
      sourceUrl:     card.sourceUrl || "",
      deepDiveContent: normalizeDeepDive(card.deepDiveContent, card.summary),
    }));

    const usage = result.response.usageMetadata;
    console.log(
      `[Pulse/Briefing] OK — ${briefing.cards.length} cards | tokens: ${usage?.totalTokenCount ?? "?"}`
    );

    return respond(200, { briefing });

  } catch (err) {
    console.error("[Pulse/Briefing] Erro:", err.message);
    const msg = err.message || "";
    if (msg.includes("401") || msg.includes("API_KEY_INVALID"))
      return respond(401, { error: "GEMINI_API_KEY inválida." });
    if (msg.includes("429") || msg.toLowerCase().includes("quota"))
      return respond(429, { error: "Limite de requisições atingido. Tente em instantes." });
    return respond(500, { error: `Erro ao gerar briefing: ${msg.slice(0, 120)}` });
  }
};

// ── Helpers ──────────────────────────────────────────────────

function normalizeDeepDive(dd, fallbackSummary) {
  if (!dd || typeof dd !== "object") dd = {};
  return {
    expanded:     dd.expanded || fallbackSummary || "",
    applications: normalizeArray(dd.applications, 3),
    steps:        normalizeArray(dd.steps, 3),
  };
}

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
  while (arr.length < min) arr.push("Consultar fontes primárias para complementar.");
  return arr;
}

function respond(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function corsHeaders() {
  return {
    "Content-Type":                 "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
