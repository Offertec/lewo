// Lewo — api/chat.js
// Vercel serverless functie. Praat veilig met de Anthropic API.
// Verwacht een POST met:
//   header  x-lewo-code: <toegangscode>
//   body    { probe: true }                          -> alleen code controleren
//   body    { messages: [{role, content}, ...] }     -> vraag stellen aan Claude
//
// De 'content' van een bericht mag tekst zijn, of een lijst blokken
// (tekst + foto's + PDF's). Web search staat aan; gebruikte bronnen worden
// mee teruggegeven.

// ---- Lewo's karakter. Pas deze tekst gerust aan naar jouw smaak. ----
const LEWO_SYSTEM = [
  "Je bent Lewo, de persoonlijke AI van Sven.",
  "Praat Nederlands, natuurlijk en menselijk, alsof je een scherpe, behulpzame vriend bent.",
  "Wees kort en direct. Kom meteen ter zake. Geen inleidende plichtplegingen, geen onnodige disclaimers, geen samenvatting achteraf.",
  "Schrijf in gewone, nette tekst. Gebruik GEEN opmaaktekens: geen sterretjes voor vet, geen hekjes voor titels, geen streepjes of nummers als opsomming. Als je toch iets moet opsommen, doe het in vloeiende zinnen of op korte losse regels zonder tekens ervoor.",
  "Je kunt foto's en PDF-bestanden bekijken die de gebruiker meestuurt, en er vragen over beantwoorden.",
  "Je kunt op het web zoeken naar actuele informatie (zoals weer, nieuws, prijzen of adressen). Doe dat gewoon wanneer het nuttig is, zonder te melden dat je gaat zoeken, en geef daarna gewoon het antwoord. Noem de bronnen niet zelf in je tekst; die worden apart onder je antwoord getoond.",
  "Wat je NIET kunt: je hebt geen toegang tot Sven's persoonlijke apps zoals zijn agenda, e-mail of bestanden op zijn computer. Je kunt daar niets in aanklikken, opslaan of inzetten. Als iemand daarom vraagt, zeg kort dat je de tekst kant-en-klaar kunt opstellen, maar dat Sven de actie zelf moet doen.",
  "Wees eerlijk. Als je iets niet zeker weet of niet kunt, zeg dat één keer in één zin en ga verder met wat je wél kunt bieden. Ga niet in de les.",
  "Denk mee, wees concreet, en pas je toon aan de vraag aan.",
].join(" ");

export default async function handler(req, res) {
  // 1) Alleen POST toestaan
  if (req.method !== "POST") {
    res.status(405).json({ error: "Alleen POST toegestaan." });
    return;
  }

  // 2) Toegangscode controleren
  const rawCodes = process.env.LEWO_ACCESS_CODES || "";
  const validCodes = rawCodes
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const sentCode = (req.headers["x-lewo-code"] || "").toString().trim();

  if (!sentCode || !validCodes.includes(sentCode)) {
    res.status(401).json({ error: "Toegangscode ongeldig." });
    return;
  }

  // 3) Body inlezen
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  // 4) Probe
  if (body.probe === true) {
    res.status(200).json({ ok: true });
    return;
  }

  // 5) Vraag ophalen
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    res.status(400).json({ error: "Geen bericht ontvangen." });
    return;
  }

  // 6) API-sleutel controleren
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res
      .status(500)
      .json({ error: "Serverfout: ANTHROPIC_API_KEY ontbreekt in Vercel." });
    return;
  }

  // 7) Claude bellen
  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Wil je terug naar de goedkopere (nog steeds sterke) versie?
        // Vervang "claude-opus-4-8" door "claude-sonnet-5".
        model: "claude-opus-4-8",
        max_tokens: 1500,
        system: LEWO_SYSTEM,
        messages: messages,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 3,
          },
        ],
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      const msg =
        data && data.error && data.error.message
          ? data.error.message
          : "Onbekende fout van Anthropic.";
      res.status(anthropicRes.status).json({ error: msg });
      return;
    }

    // Tekst + bronnen verzamelen
    let reply = "";
    const sources = [];
    const seen = new Set();

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (!block) continue;

        if (block.type === "text") {
          if (block.text) reply += block.text;
          if (Array.isArray(block.citations)) {
            for (const c of block.citations) {
              if (c && c.url && !seen.has(c.url)) {
                seen.add(c.url);
                sources.push({ title: c.title || c.url, url: c.url });
              }
            }
          }
        }

        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r && r.url && !seen.has(r.url)) {
              seen.add(r.url);
              sources.push({ title: r.title || r.url, url: r.url });
            }
          }
        }
      }
    }

    reply = reply.trim();
    if (!reply) {
      reply = "Ik kreeg hier geen tekstantwoord op. Probeer je vraag anders te stellen.";
    }

    res.status(200).json({ reply, sources: sources.slice(0, 6) });
  } catch (err) {
    res.status(500).json({
      error:
        "Serverfout bij het bellen van Claude: " +
        (err && err.message ? err.message : String(err)),
    });
  }
}
