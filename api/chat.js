// api/chat.js — de veilige achterkant van Lewo
//
// Twee geheimen staan als omgevingsvariabelen in Vercel (nooit in dit bestand):
//   ANTHROPIC_API_KEY   -> jouw Claude-API-sleutel (sk-ant-...)
//   LEWO_ACCESS_CODES   -> toegangscodes, gescheiden door komma's
//                          bv:  lente-2026,marie7,team-sven
// Iedereen aan wie jij zo'n code geeft, kan chatten. Een code weghalen =
// die persoon buitensluiten (env-variabele aanpassen en opnieuw deployen).

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Alleen POST is toegestaan." });
    return;
  }

  // ---- 1. Toegangscontrole (server-side, niet te omzeilen) ----
  const allowed = (process.env.LEWO_ACCESS_CODES || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (allowed.length === 0) {
    res.status(500).json({ error: "Nog geen toegangscodes ingesteld (LEWO_ACCESS_CODES)." });
    return;
  }

  const code = (req.headers["x-lewo-code"] || req.body?.code || "").toString().trim();
  if (!allowed.includes(code)) {
    res.status(401).json({ error: "Onjuiste of ontbrekende toegangscode." });
    return;
  }

  // Lichte controle-aanvraag vanaf het toegangsscherm: code is geldig, maar
  // we praten (nog) niet met Claude, zodat een geldige code niets kost.
  if (req.body?.probe === true) {
    res.status(200).json({ ok: true });
    return;
  }

  // ---- 2. Praten met Claude ----
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Serversleutel ontbreekt (ANTHROPIC_API_KEY niet ingesteld)." });
    return;
  }

  // ====== PAS DIT AAN: wie is Lewo? ======
  const SYSTEM_PROMPT =
    "Je bent Lewo, de persoonlijke AI-assistent van Sven. Je bent behulpzaam, " +
    "vriendelijk, eerlijk en to-the-point. Je praat standaard Nederlands, maar " +
    "schakelt mee met de taal van de gebruiker. Je helpt met zowat alles: " +
    "vragen beantwoorden, teksten schrijven, brainstormen, uitleggen, nakijken. " +
    "Weet je iets niet zeker, zeg dat dan eerlijk in plaats van te gokken.";
  // =======================================

  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5", // slim gesprek; wissel voor "claude-haiku-4-5" = goedkoper/sneller
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: messages,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      res.status(502).json({ error: "Fout bij Claude.", detail });
      return;
    }

    const data = await upstream.json();
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.status(200).json({ reply: reply || "..." });
  } catch (err) {
    res.status(500).json({ error: "Onverwachte fout.", detail: String(err) });
  }
};
