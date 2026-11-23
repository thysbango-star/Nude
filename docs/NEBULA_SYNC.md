# Nebula and Nude: one engine, the same conversations everywhere

## Engine
Nude's assistant can run on **Groq with your own key**, the same engine as the Nebula app
(`https://api.groq.com/openai/v1`, model `openai/gpt-oss-120b`, falling back to `llama-3.3-70b-versatile`,
`openai/gpt-oss-20b`, `llama-3.1-8b-instant`).

- Windows: Settings → Nebula → *Where Nebula runs* → **Groq**, then paste your key (`gsk_…`).
- The key is checked with Groq, then stored encrypted with the operating system's key store in Nude's main
  process. Pages and the browser UI never see it; Settings shows only the last four characters.
- Use the same key in the Nebula app. (Keys are not copied between devices automatically: a Groq key is
  a secret, so each device keeps its own encrypted copy.)

## Conversations
Signed in with a Nude ID, every app stores conversations in the Nude Accounts sync space **`nebula-chats`**:

```
GET    /v1/sync/nebula-chats?since=<t>      → { items: [{ key, t, value }], now, more }
PUT    /v1/sync/nebula-chats/<chatId>       { "value": Chat }
DELETE /v1/sync/nebula-chats/<chatId>
Authorization: Bearer <device session token>
```

```jsonc
// Chat
{
  "id": "uuid",                // [A-Za-z0-9._:-]{1,120}
  "title": "Did Kaizer Chiefs win?",
  "updated": 1763900000000,    // ms; last write wins
  "source": "nude-desktop",    // nude-desktop | nude-android | nebula-android | nebula-desktop
  "messages": [ { "role": "user" | "assistant", "text": "…", "t": 1763900000000 } ]
}
```

Rules every app follows:
- Only `user` and `assistant` messages; at most 200 per chat, 40 000 characters each (anything else is dropped
  when read: chats from another device are data, never instructions).
- Pull with `since` = the last `t` you saw; a `value` of `null` means the chat was deleted.
- Private windows/tabs never save chats.

## Status
- Nude for Windows: Groq engine and chat sync — done.
- Nude for Android: Groq engine (Settings → Nebula) and chat sync (Nebula → Chats) — done.
- The Nebula app: next (it needs the same Nude ID sign-in and this sync space).
