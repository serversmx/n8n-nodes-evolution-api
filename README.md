# n8n-nodes-evolution-api

n8n community node for **[Evolution API](https://github.com/EvolutionAPI/evolution-api) v2** (WhatsApp):
instances, messages, chats, groups, profiles, labels, webhooks and the Chatwoot / chatbot
integrations. Zero runtime dependencies, usable as an AI Agent tool.

> **Status: 0.1.0 (scaffold).** The **Instance** resource is complete. Every other resource ships
> with one working operation and is being filled in. See [CHANGELOG.md](CHANGELOG.md).

- [English](#english)
- [Español](#español)

---

## English

### Compatibility

| Component | Versions |
|---|---|
| Evolution API | 2.3.x (tested against 2.3.7 sources) and 2.4.x (2.4.0-rc2). Evolution Go is **not** supported (different API). |
| n8n | 2.x (built against `n8n-workflow` 2.13). |
| Node.js | 18+ |

### Installation

In n8n: **Settings → Community Nodes → Install** and enter
`@renatoascencio/n8n-nodes-evolution-api`.

### Credentials: "Evolution API v2"

| Field | Description |
|---|---|
| Base URL | Your Evolution server, e.g. `https://evolution.example.com` (no trailing path). |
| API Key | The global key (`AUTHENTICATION_API_KEY`) **or** one instance token (the `hash` returned on create). Instance tokens only work for their instance; creating instances needs the global key. |
| Default Instance Name | Optional. Used when a node's *Instance Name* is empty. Recommended with instance tokens. |

The credential test calls `GET /instance/connectionState/<Default Instance>` (or
`GET /instance/fetchInstances` when no default instance is set), which accepts both key types.

### Evolution API 2.4 license

Evolution API 2.4 answers **HTTP 503 `LICENSE_REQUIRED`** on every API route until the server is
activated. The node reports it as *"Evolution API license not activated … Activate it at
&lt;register_url&gt;"* and never retries it. Activate the server at `<Base URL>/manager/login` and
check `GET <Base URL>/license/status` before upgrading.

### Behavior

- Every input item is processed (with `pairedItem`), and *Continue On Fail* is supported.
- Errors show Evolution's own message (`response.message`) plus a hint per HTTP status.
- `429` is retried with backoff (honoring `Retry-After`); `502/503` are retried for idempotent
  requests only, and `504` only for read requests (the server may already have applied a write).
  Sending messages is never retried on 5xx, so no duplicates.
- Numbers such as `+52 1 (55) 1234-5678` are normalized to digits. JIDs (`@lid`, `@g.us`,
  `@s.whatsapp.net`, `@broadcast`, `@newsletter`) are never rewritten.
- Instance → Get Many hides secrets (instance token, Chatwoot token, proxy password) unless
  *Include Secrets* is on, and returns no items when a filter matches no instance.
- Connect / Create can output the QR code as a PNG binary.

### Resources

| Resource | Operations |
|---|---|
| Instance | Connect (QR / pairing code), Create (Baileys, Cloud API, Evolution channel; settings, webhook, proxy and Chatwoot blocks), Delete, Get Connection State, Get Many, Logout, Restart, Set Presence |
| Message | Send Text *(more coming)* |
| Chat | Check Numbers *(more coming)* |
| Group | Get Many *(more coming)* |
| Profile | Get *(more coming)* |
| Label | Get Many *(more coming)* |
| Call | Offer (Evolution currently returns a placeholder and places no call) |
| Settings / Proxy / Webhook / Chatwoot | Get *(Set coming)* |
| Chatbot | Get Many bots of an integration *(more coming)* |
| Template | Get Many (WhatsApp Cloud API) *(more coming)* |
| **Evolution API Trigger** | Preview: receives webhook events configured manually |

### Security notes

- Evolution 2.3.7 and 2.4.0-rc2 let an instance token act on another instance through a
  `?instanceName=` query parameter. This node never forwards user query parameters, but do not
  treat instance tokens as tenant isolation on those versions.
- Evolution's outgoing webhooks are not signed. Protect the trigger URL (secret path, headers or
  `jwt_key`).

### Development

```bash
npm install --ignore-scripts
npm run build
npm run lint
npm test
```

---

## Español

Nodo comunitario de n8n para **Evolution API v2** (WhatsApp): instancias, mensajes, chats, grupos,
perfiles, etiquetas, webhooks e integraciones con Chatwoot y chatbots. Sin dependencias en tiempo
de ejecución y utilizable como herramienta del AI Agent.

> **Estado: 0.1.0 (base).** El recurso **Instance** está completo; el resto trae una operación
> funcional y se irá completando.

### Compatibilidad

Evolution API 2.3.x y 2.4.x (Evolution Go no es compatible), n8n 2.x, Node.js 18+.

### Instalación

En n8n: **Settings → Community Nodes → Install** → `@renatoascencio/n8n-nodes-evolution-api`.

### Credencial "Evolution API v2"

- **Base URL**: la URL de tu servidor Evolution.
- **API Key**: la llave global (`AUTHENTICATION_API_KEY`) o el token de una instancia (el `hash`
  que devuelve *Create*). Con token de instancia solo se opera esa instancia; crear instancias
  requiere la llave global.
- **Default Instance Name** (opcional): se usa cuando el campo *Instance Name* del nodo está
  vacío. Recomendado si usas token de instancia.

### Licencia de Evolution 2.4

Evolution 2.4 responde **503 `LICENSE_REQUIRED`** en todas las rutas hasta activar el servidor. El
nodo muestra un error claro con la URL de activación (`<Base URL>/manager/login`) y no reintenta.
Activa la licencia y confirma con `GET <Base URL>/license/status` antes de actualizar.

### Comportamiento

- Procesa todos los ítems de entrada, con `pairedItem` y soporte de *Continue On Fail*.
- Reintenta `429` con espera progresiva; `502/503` solo en peticiones idempotentes y `504` solo
  en lecturas (el servidor pudo haber aplicado ya una escritura). El envío de mensajes nunca se
  reintenta ante 5xx, así que no se duplican.
- Normaliza números (`+52 1 55…` → dígitos) sin tocar JIDs `@lid`, `@g.us`, `@s.whatsapp.net`,
  `@broadcast` ni `@newsletter`.
- *Instance → Get Many* oculta secretos salvo que actives *Include Secrets*.

### Desarrollo

```bash
npm install --ignore-scripts
npm run build && npm run lint && npm test
```

## License

[MIT](LICENSE)
