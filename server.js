// BR Proxy Relay — reaproveita o proxy IPRoyal (que já foi pago) para dar
// saída no Brasil ao rastreio da Movimente/Brudam.
//
// O Supabase Edge não consegue usar um proxy "cru" (limitação do runtime).
// Então este pequeno serviço Node roda o proxy no lugar dele: recebe do Edge
// um POST { url, method, headers, body }, refaz a requisição SAINDO pelo
// IPRoyal (IP brasileiro) e devolve o corpo em base64 — exatamente o contrato
// que a função track-shipments (fetchViaBrazilProxy) já espera.

const http = require("http");
const { ProxyAgent, fetch } = require("undici");

const PORT = process.env.PORT || 3000;
const RELAY_API_KEY = process.env.RELAY_API_KEY || "";
// Ex.: http://USUARIO:SENHA_country-br@geo.iproyal.com:12321
const PROXY_URL = process.env.PROXY_URL || "";
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 25000);

if (!PROXY_URL) console.warn("WARN: PROXY_URL não configurado — vai sair sem proxy!");
if (!RELAY_API_KEY) console.warn("WARN: RELAY_API_KEY não configurado — relay ABERTO!");

const proxyAgent = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

// Ring buffer de diagnóstico: registra as últimas requisições de proxy que
// chegaram (host de destino + horário), exposto em GET /stats. Serve pra provar
// se a edge function do Supabase está realmente chamando o relay.
const recent = [];
let proxyCount = 0;
function noteRequest(targetUrl) {
  proxyCount++;
  let host = "";
  try { host = new URL(targetUrl).host; } catch { host = String(targetUrl).slice(0, 60); }
  recent.push({ host, at: new Date().toISOString() });
  if (recent.length > 30) recent.shift();
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // Health check (Render/Railway usam pra saber se subiu, e serve de keep-alive).
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    return send(res, 200, { ok: true, proxy: Boolean(proxyAgent) });
  }
  if (req.method === "GET" && req.url === "/stats") {
    return send(res, 200, { proxyCount, recent });
  }
  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed" });
  }

  // Autenticação simples: X-Api-Key OU Authorization: Bearer <key>.
  const provided =
    req.headers["x-api-key"] ||
    String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (RELAY_API_KEY && provided !== RELAY_API_KEY) {
    return send(res, 401, { error: "Unauthorized" });
  }

  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 5_000_000) req.destroy();
  });
  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }

    const targetUrl = payload.url;
    if (!targetUrl) return send(res, 400, { error: "Missing url" });
    noteRequest(targetUrl);

    const method = (payload.method || "GET").toUpperCase();
    const headers =
      payload.headers && typeof payload.headers === "object" ? { ...payload.headers } : {};
    // Remove cabeçalhos que não devem ser repassados.
    for (const k of Object.keys(headers)) {
      if (["host", "content-length", "connection"].includes(k.toLowerCase())) delete headers[k];
    }
    const body = method !== "GET" && method !== "HEAD" ? payload.body : undefined;

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetch(targetUrl, {
        method,
        headers,
        body,
        dispatcher: proxyAgent,
        signal: ctrl.signal,
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      // base64 — a função track-shipments (decodeProxyBody) decodifica sozinha.
      return send(res, 200, {
        httpResponseStatusCode: upstream.status,
        httpResponseBody: buf.toString("base64"),
      });
    } catch (err) {
      return send(res, 502, {
        error: "Proxy fetch failed",
        detail: String((err && err.message) || err),
      });
    } finally {
      clearTimeout(to);
    }
  });
});

server.listen(PORT, () => console.log(`BR proxy relay ouvindo na porta ${PORT}`));
