# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

Initial scaffold of the package, built from the Evolution API 2.3.7 and 2.4.0-rc2 sources.

### Added

- **Credential "Evolution API v2"** (`evolutionWhatsAppApi`): Base URL, API key (global key or
  instance token, sent as the `apikey` header) and optional Default Instance Name. The credential
  test works with both key types and explains `503 LICENSE_REQUIRED` (Evolution 2.4), `401` and
  `404`. The internal name avoids the `evolutionApi`, `evolutionApiApi` and `evolutionApiV2Api`
  credential types of other community packages.
- **Evolution API node** (programmatic, `usableAsTool`):
  - Processes every input item with `pairedItem` and supports *Continue On Fail*.
  - Shared *Instance Name* resource locator (list of instances or a name/expression), falling
    back to the credential's Default Instance Name.
  - Resource registry: each resource lives in `nodes/EvolutionApi/resources/<resource>/`.
- **Instance resource** (complete): Connect (QR code, pairing code, QR as PNG binary), Create
  (WhatsApp Baileys, WhatsApp Cloud API, Evolution channel; settings, webhook with headers and
  events, proxy and Chatwoot blocks), Delete, Get Connection State, Get Many (filters applied
  server and client side, secrets hidden by default), Logout, Restart (POST), Set Presence.
- **First operations of the other resources**: Message → Send Text, Chat → Check Numbers,
  Group → Get Many, Profile → Get, Label → Get Many, Call → Offer, Settings/Proxy/Webhook/Chatwoot
  → Get, Chatbot → Get Many, Template → Get Many.
- **Evolution API Trigger** (preview): receives webhook events posted to its URL.
- Shared helpers: request with retries (429 always; 502/503 for idempotent requests; 504 for
  read requests only, because Evolution may already have applied the write), Evolution error
  normalization (including `LICENSE_REQUIRED` with the activation URL and a readable "number is
  not on WhatsApp" message), soft error detection (`{ error: true }` answered with HTTP 200),
  number/JID normalization that keeps `@lid`, `@g.us`, `@s.whatsapp.net`, `@broadcast` and
  `@newsletter`, safe path encoding (instance names and IDs `.`/`..` are rejected), media helpers
  (URL, base64, n8n binary, multipart upload) and base64 → binary conversion.
- Resources can register their own loadOptions / listSearch methods (`methods` export).
- Test harness (`test/helpers/mockExecuteFunctions.ts`) and unit tests.
