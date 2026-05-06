// ============================================================
//  Pulse v0.4 — Netlify Function: generate-mission
//  Arquivo: netlify/functions/generate-mission.js
//
//  Transforma um card do Pulse em uma missão prática acionável.
//
//  Recebe : POST { "card": { title, category, summary, ... } }
//  Retorna: { "mission": { missionTitle, objective, ... } }
// ============================================================

const { GoogleGenerativeAI } = require("@google/generative-ai");

const MISSION_PROMPT = `Você é o criador de missões do Pulse, um feed pessoal de inteligência do Lucas.

PERFIL DO LUCAS:
- Estudante de Engenharia Elétrica na Unicamp (4º ano).
- Trabalha com processos, qualidade e melhoria contínua no Agibank.
- TCC sobre data centers sustentáveis: PUE, WUE, CUE, refrigeração, IA, impactos no Brasil.
- Interesses: dados, ML, crédito, fintechs, automação, engenharia elétrica, energia, francês.
- Prefere ações práticas, concretas e mensuráveis.

SUA TAREFA:
Transformar o card abaixo em uma missão prática que o Lucas possa executar com foco e clareza.

REGRAS:
1. A missão deve ser ACIONÁVEL — não um resumo do card, mas um plano de execução.
2. "missionTitle": título da missão em formato de conquista (ex: "Mapear e comparar WUE de 5 data centers brasileiros").
3. "objective": o que o Lucas vai ter feito/aprendido/produzido ao terminar.
4. "whyThisMatters": impacto direto para TCC, carreira ou vida do Lucas.
5. "estimatedDuration": tempo total realista para completar a missão inteira.
6. "difficulty": "Baixa" (< 30 min, bem definido), "Média" (30 min–2h, requer foco), "Alta" (> 2h, requer planejamento).
7. "deliverable": resultado tangível e verificável. Ex: "Script Python publicado no GitHub", "Seção 3.2 do TCC redigida com 3 citações".
8. "checklist": exatamente 5 itens, ordenados logicamente. Cada item começa com verbo no infinitivo. Específico, não genérico.
9. "firstStep": o primeiro passo de 5 minutos para começar AGORA. Simples e imediato.
10. "tools": até 4 ferramentas concretas. Sem duplicatas. Só o que é realmente necessário.
11. Linguagem direta, em português brasileiro.

RESPONDA APENAS COM JSON VÁLIDO. Sem markdown:

{
  "missionTitle": "Título da missão como conquista",
  "objective": "O que o Lucas vai ter concluído ao final da missão.",
  "whyThisMatters": "Impacto direto e concreto para o TCC, carreira ou vida do Lucas.",
  "estimatedDuration": "1h30min",
  "difficulty": "Média",
  "deliverable": "Resultado tangível e verificável ao final.",
  "checklist": [
    "Passo 1: ação específica com detalhe",
    "Passo 2: ação específica com detalhe",
    "Passo 3: ação específica com detalhe",
    "Passo 4: ação específica com detalhe",
    "Passo 5: ação específica com detalhe"
  ],
  "firstStep": "Ação imediata de 5 minutos para começar agora.",
  "tools": ["Ferramenta 1", "Ferramenta 2", "Ferramenta 3"]
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
    console.error("[Pulse/Mission] GEMINI_API_KEY não configurada.");
    return respond(500, { error: "Chave GEMINI_API_KEY não configurada no servidor." });
  }

  let card;
  try {
    const body = JSON.parse(event.body || "{}");
    card = body.card;
    if (!card || !card.title) throw new Error("Card inválido.");
  } catch {
    return respond(400, { error: "Body inválido. Envie { card: { title, category, summary, ... } }." });
  }

  // Monta contexto do card para o modelo
  const cardContext = `
CARD DO PULSE:
Título: ${card.title}
Categoria: ${card.category || "—"}
Resumo: ${card.summary || "—"}
Por que importa: ${card.whyItMatters || "—"}
Conexão: ${card.connection || "—"}
Ação sugerida: ${card.suggestedAction || "—"}
${card.deepDiveContent?.expanded ? `Contexto expandido: ${card.deepDiveContent.expanded}` : ""}
`.trim();

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.75,
        topP: 0.9,
        maxOutputTokens: 1000,
        responseMimeType: "application/json",
      },
    });

    const fullPrompt = `${MISSION_PROMPT}\n\n---\n${cardContext}\n\nGere a missão completa para este card.`;

    const result  = await model.generateContent(fullPrompt);
    const rawText = result.response.text();
    if (!rawText) throw new Error("Resposta vazia do Gemini.");

    let mission;
    try {
      const clean = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      mission = JSON.parse(clean);
    } catch {
      console.error("[Pulse/Mission] JSON inválido:", rawText.slice(0, 300));
      throw new Error("Gemini retornou JSON inválido.");
    }

    // Valida campos obrigatórios
    const required = ["missionTitle", "objective", "deliverable", "checklist", "firstStep"];
    for (const f of required) {
      if (!mission[f]) throw new Error(`Campo obrigatório ausente: "${f}".`);
    }

    // Normaliza
    mission.checklist = Array.isArray(mission.checklist)
      ? mission.checklist.map(String).filter(Boolean).slice(0, 5)
      : [];
    while (mission.checklist.length < 5) mission.checklist.push("Revisar o progresso e ajustar se necessário.");

    mission.tools = Array.isArray(mission.tools)
      ? mission.tools.map(String).filter(Boolean).slice(0, 4)
      : [];
    mission.difficulty       = mission.difficulty       || "Média";
    mission.estimatedDuration= mission.estimatedDuration|| "1h";
    mission.whyThisMatters   = mission.whyThisMatters   || card.whyItMatters || "";

    const usage = result.response.usageMetadata;
    console.log(
      `[Pulse/Mission] OK — "${mission.missionTitle?.slice(0,50)}" | tokens: ${usage?.totalTokenCount ?? "?"}`
    );

    return respond(200, { mission });

  } catch (err) {
    console.error("[Pulse/Mission] Erro:", err.message);
    const msg = err.message || "";
    if (msg.includes("401") || msg.includes("API_KEY_INVALID"))
      return respond(401, { error: "GEMINI_API_KEY inválida." });
    if (msg.includes("429") || msg.toLowerCase().includes("quota"))
      return respond(429, { error: "Limite de requisições. Tente em instantes." });
    return respond(500, { error: `Erro ao gerar missão: ${msg.slice(0, 120)}` });
  }
};

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
