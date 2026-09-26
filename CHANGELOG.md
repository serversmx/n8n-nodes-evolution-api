# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-25

Initial release, verified route-by-route against the Evolution API 2.3.7 and 2.4.0-rc2 source
code (not just its docs).

### Added

- **Example workflows and screenshots**: importable workflows in `examples/workflows` (with pinned sample data) and README screenshots taken in n8n 2.40.7.
- **Credential "Evolution API v2"** (`evolutionWhatsAppApi`): Base URL, API Key (accepts either
  the global `AUTHENTICATION_API_KEY` or one instance token) and an optional Default Instance
  Name, sent as the `apikey` header. The credential test adapts to the key type and explains
  `503 LICENSE_REQUIRED`, `401` and `404` responses. The internal credential name is
  `evolutionWhatsAppApi`, distinct from `evolutionApi` / `evolutionApiApi` / `evolutionApiV2Api`
  used by other community packages, so this node can be installed alongside them.
- **Evolution API node** (13 resources, 101 operations total): Call (1), Chat (17), Chatbot (15),
  Chatwoot (2), Group (17), Instance (8), Label (3), Message (15), Profile (9), Proxy (2),
  Settings (2), Template (6), Webhook (4). Every input item is processed independently with
  `pairedItem`, *Continue On Fail* is supported, and the node is `usableAsTool` so it can be
  attached as a tool to an AI Agent node.
- **Evolution API Trigger** node: receives Evolution's webhook events.
  - **Automatic mode** takes over the target instance's webhook on activation (`POST
    /webhook/set`) and restores the previous configuration (or disables the webhook) on
    deactivation, including recovery after an n8n restart and safe handling of "Listen for test
    event" sessions.
  - **Manual mode** lets you point Evolution (an instance webhook or the global
    `WEBHOOK_GLOBAL_URL`) at the trigger's URL yourself.
  - **Authentication**: HS256 JWT verification of Evolution's `jwt_key`, a random secret header,
    or both (Automatic mode generates and rotates these secrets itself; Manual mode verifies
    whatever you configured in Evolution, including "None" for the global webhook, which cannot
    send custom headers).
  - **Deduplication** of retried deliveries (Evolution retries undelivered webhooks up to 10
    times, and an instance can have both an instance and a global webhook active).
  - The `apikey` field Evolution embeds in the payload (when
    `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true`) is stripped by default so instance tokens
    are not stored in executions.
  - Event, message-type, instance, group/newsletter/broadcast and "from me" filters; embedded
    media becomes n8n binary data.
- **Evolution API 2.3.7 and 2.4.0-rc2 support**: every operation targets routes present in 2.3.7.
  2.4-only routes (Send Carousel, Mark As Played, Get Poll Votes, Get Channels, Update Member Add
  Mode, Generate Message ID) and 2.4-only fields/options (`messageId`, `gifPlayback` /
  `gifAttribution`, quoted audio, the 2-button CTA limit, the Messaging History Set trigger
  event) are marked "Requires Evolution API 2.4+" in the UI; calling a 2.4-only route against a
  2.3.7 server surfaces Evolution's own 404 with a hint that the route needs a newer server.
- **503 `LICENSE_REQUIRED` handling**: Evolution API 2.4 blocks every route until the server is
  activated. The node turns this into a clear, non-retried error that includes the activation URL
  (`register_url`, e.g. `<Base URL>/manager/login`) and points at `GET <Base URL>/license/status`.
- **Binary media**: sending media (image, video, audio, voice notes, stickers, status) accepts an
  n8n binary property, a URL or base64, and uploads as multipart when possible; downloading media
  (Chat → Download Media), the instance QR code (Instance → Connect / Create) and the trigger's
  embedded media all come back as n8n binary data.
- **AI Agent tool support**: the Evolution API node has `usableAsTool: true`, so it can be added
  as a tool under an AI Agent node to let a model send messages, look up chats/contacts, manage
  groups, etc.
- Shared request layer with automatic retries (`429` always, honoring `Retry-After`; `502`/`503`
  only for idempotent requests; `504` only for reads, since Evolution may already have applied a
  write; sends are never retried on 5xx, so messages are never duplicated), Evolution error
  normalization (`response.message`, then `message`, then `error`), soft-error detection (routes
  that answer HTTP 200 with `{ error: true, message }`), number/JID normalization that matches
  Evolution's own `createJid` rules while leaving explicit JIDs (`@lid`, `@g.us`,
  `@s.whatsapp.net`, `@broadcast`, `@newsletter`) untouched, and safe path encoding (instance
  names and other path IDs of `.`/`..` are rejected instead of being sent to the wrong route).
- Full test suite (Jest) covering every resource, the credential, the node's execute loop and the
  trigger's registration/auth/dedupe logic against a mocked HTTP layer.

### Why this package instead of the existing community node

An audit of the existing `n8n-nodes-evolution-api` package (as of the version available at the
time, 1.0.4) found a few gaps this package specifically addresses:

- **Every input item is processed.** The audited version only acted on the first item of the
  input; this node loops over all items and reports errors per item (with *Continue On Fail*
  support), so batches of messages, chats or instances are handled correctly.
- **Read-merge-write for full-object endpoints.** Evolution's `settings/set`, `chatwoot/set`,
  `proxy/set` and `chat/updatePrivacySettings` all require the *complete* object on every write,
  or they can reset the fields you didn't intend to change. This node reads the current
  configuration first, merges in only the fields you set, and writes the full object back.
- **Field names that match Evolution's schema.** Evolution's request validation silently ignores
  properties it doesn't recognize (it doesn't reject the request), so a body sent with a slightly
  wrong key just does nothing instead of failing loudly. This node uses the exact field names
  Evolution's schema expects (for example the webhook and text-mention fields).
- No runtime dependencies, retries that respect which requests are safe to repeat, and the other
  behavior described above (LICENSE_REQUIRED handling, JID-safe number normalization, path
  encoding, binary media, AI tool support).

This isn't a criticism of the other package specifically — Evolution API's contract has plenty of
sharp edges even when you have the source in front of you — just the concrete reasons a new
implementation, verified line-by-line against the Evolution API source, was worth building.
