# BR Proxy Relay (Movimente / Brudam)

Mini-serviço que dá **saída no Brasil** para o rastreio da Movimente, usando o
proxy **IPRoyal** que já foi contratado. O Supabase Edge não consegue usar o
IPRoyal direto (limitação do runtime), então ele chama este relay, que refaz a
requisição saindo pelo IPRoyal e devolve o conteúdo.

```
Supabase Edge (track-shipments)  ──POST {url}──►  este relay  ──via IPRoyal (IP BR)──►  Brudam/Movimente
```

## Variáveis de ambiente

| Variável         | O que é                                                                 |
|------------------|--------------------------------------------------------------------------|
| `PROXY_URL`      | URL completa do IPRoyal. Ex.: `http://USUARIO:SENHA_country-br@geo.iproyal.com:12321` |
| `RELAY_API_KEY`  | Uma senha que você inventa. O Supabase manda ela pra provar que é você.   |
| `PORT`           | Preenchido automaticamente pelo Render/Railway. Não precisa mexer.       |

## Deploy no Render (grátis)

1. Suba esta pasta para um repositório no GitHub.
2. Em https://render.com → **New → Web Service** → conecte o repositório.
3. Runtime **Node**, Build `npm install`, Start `npm start`, plano **Free**.
4. Em **Environment**, adicione:
   - `PROXY_URL` = a URL do IPRoyal (dashboard do IPRoyal → Residential → formato `user:pass@host:port`; prefixe `http://`).
   - `RELAY_API_KEY` = uma senha forte qualquer (guarde — vai no Supabase também).
5. Deploy. Anote a URL pública, ex.: `https://br-proxy-relay.onrender.com`.

## Ligar no Supabase (secrets da função)

No projeto Lovable/Supabase, configure os secrets:

| Secret                       | Valor                                              |
|------------------------------|----------------------------------------------------|
| `BRAZIL_PROXY_API_KEY`       | o **mesmo** valor de `RELAY_API_KEY`               |
| `BRAZIL_PROXY_API_URL`       | a URL pública do relay (ex.: `https://br-proxy-relay.onrender.com/`) |
| `BRAZIL_PROXY_API_AUTH_HEADER` | `X-Api-Key`                                      |
| `BRAZIL_PROXY_COUNTRY`       | `br`                                               |

Pronto. O rastreio da Movimente passa a sair pelo Brasil.

## Testar

```bash
curl -s -X POST https://SEU-RELAY.onrender.com/ \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: SUA_RELAY_API_KEY" \
  -d '{"url":"https://api.ipify.org?format=json","method":"GET"}'
```

Decodifique o `httpResponseBody` (base64) — deve mostrar um **IP brasileiro**.

## Observação (Render free)

O plano free hiberna após ~15 min sem uso (1ª chamada fica lenta). O cron de
rastreio roda a cada 10 min, o que mantém o serviço acordado.
