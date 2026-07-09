// Lewo — api/chat.js
// Vercel serverless functie. Praat veilig met de Anthropic API.
// Verwacht een POST met:
//   header  x-lewo-code: <toegangscode>
//   body    { probe: true }                          -> alleen code controleren
//   body    { messages: [{role, content}, ...] }     -> vraag stellen aan Claude
//
// Deze versie heeft internet-toegang (web search) aan: Lewo kan live dingen
// opzoeken zoals het weer, nieuws, prijzen of adressen.

// ---- Lewo's karakter. Pas deze tekst gerust aan naar jouw smaak. ----
const LEWO_SYSTEM = [
  "Je bent Lewo, de persoonlijke AI van Sven.",
  "Praat Nederlands, natuurlijk en menselijk, alsof je een scherpe, behulpzame vriend bent.",
  "Wees kort en direct. Kom meteen ter zake. Geen inleidende plichtplegingen, geen onnodige disclaimers, geen samenvatting achteraf.",
  "Schrijf in gewone, nette tekst. Gebruik GEEN opmaaktekens: geen sterretjes voor vet, geen hekjes voor titels, geen streepjes of nummers als opsomming. Als je toch iets moet opsommen, doe het in vloeiende zinnen of op korte losse regels zonder tekens ervoor.",
  "Je kunt op het web zoeken naar actuele informatie (zoals weer, nieuws, prijzen of adressen). Doe dat gewoon wanneer het nuttig is, zonder te melden dat je gaat zoeken, en geef daarna gewoon het antwoord.",
  "Wat je NIET kunt: je hebt geen toegang tot Sven's persoonlijke apps zoals zijn agenda, e-mail of bestanden. Je kunt daar niets in aanklikken, opslaan of inzetten. Als iemand daarom vraagt, zeg kort dat je de tekst kant-en-klaar kunt opstellen, maar dat Sven de actie zelf moet doen.",
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

  // 3) Body inlezen (soms komt die binnen als tekst i.p.v. object)
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  // 4) Probe: enkel bevestigen dat de code klopt, zonder Claude te bellen
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

  // 7) Claude bellen (met web search ingeschakeld)
  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system: LEWO_SYSTEM,
        messages: messages,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            // max_uses beschermt je tegoed: hoogstens 3 zoekopdrachten per vraag.
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

    // Het antwoord kan uit meerdere blokken bestaan (zeker met web search).
    // We plakken alle tekstblokken aan elkaar tot het volledige antwoord.
    let reply = "";
    if (Array.isArray(data.content)) {
      reply = data.content
        .filter((block) => block && block.type === "text" && block.text)
        .map((block) => block.text)
        .join("")
        .trim();
    }

    if (!reply) {
      reply = "Ik kreeg hier geen tekstantwoord op. Probeer je vraag anders te stellen.";
    }

    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({
      error:
        "Serverfout bij het bellen van Claude: " +
        (err && err.message ? err.message : String(err)),
    });
  }
}
