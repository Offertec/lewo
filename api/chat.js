// Lewo — api/chat.js
// Vercel serverless functie. Praat veilig met de Anthropic API.
// Verwacht een POST met:
//   header  x-lewo-code: <toegangscode>
//   body    { probe: true }                          -> alleen code controleren
//   body    { messages: [{role, content}, ...] }     -> vraag stellen aan Claude

// ---- Lewo's karakter. Pas deze tekst gerust aan naar jouw smaak. ----
const LEWO_SYSTEM = [
  "Je bent Lewo, de persoonlijke AI van Sven.",
  "Praat Nederlands, natuurlijk en menselijk, alsof je een scherpe, behulpzame vriend bent.",
  "Wees kort en direct. Kom meteen ter zake. Geen inleidende plichtplegingen, geen onnodige disclaimers, geen samenvatting achteraf.",
  "Schrijf in gewone, nette tekst. Gebruik GEEN opmaaktekens: geen sterretjes voor vet, geen hekjes voor titels, geen streepjes of nummers als opsomming. Als je toch iets moet opsommen, doe het in vloeiende zinnen of op korte losse regels zonder tekens ervoor.",
  "Wees eerlijk. Als je iets niet kunt, zeg dat één keer in één zin en ga verder met wat je wél kunt bieden. Ga niet in de les.",
  "Je kunt alleen tekst schrijven in dit gesprek. Je hebt geen toegang tot agenda's, e-mail, bestanden of andere apps en kunt dus niets aanklikken, opslaan of ergens inzetten. Als iemand daarom vraagt, zeg kort dat je de tekst kant-en-klaar kunt opstellen, maar dat Sven de actie zelf moet doen.",
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
        model: "claude-sonnet-5",
        max_tokens: 1200,
        system: LEWO_SYSTEM,
        messages: messages,
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

    const reply =
      data.content && data.content[0] && data.content[0].text
        ? data.content[0].text
        : "";

    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({
      error:
        "Serverfout bij het bellen van Claude: " +
        (err && err.message ? err.message : String(err)),
    });
  }
}
