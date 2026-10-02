# Nogizaka pull → headless, COSM-style (implemented)

**Nogizaka mobame now runs server-side on the Fetch path — no browser.** Same as
COSM/b.stage. Implemented in `src/lib/server/nogizaka.ts` + a `nogizaka` branch in
`src/app/api/fetch/route.ts`.

```
POST /api/fetch { "key": "nogizaka" }   → pull new mail across your subscribed members
POST /api/fetch {}                       → Fetch-all now includes Nogizaka too
```
Verified: first call inserted 47 new messages; a second call (using the rotated
session persisted to `app_state`) succeeded — the loop sustains with no browser.

## How the web auth actually works (verified live, differs from the mobile tooling)
The `message.nogizaka46.com` Flutter **web** app does NOT store a reusable
`refresh_token` like the mobile app (colmsg). Instead:

- Sign-in is federated Google OAuth (`AUTH_TYPE_KEY: "google"`). The 1-hour access
  JWT lives encrypted in `localStorage["FlutterSecureStorage.TOKEN_KEY"]` (AES-GCM,
  key in `localStorage["FlutterSecureStorage"]`, format `base64(iv).base64(ct)`).
- The durable auth is a **rotating server `session` cookie** (a UUID, httpOnly,
  domain `.message.nogizaka46.com`, paths `/v2/update_token` and `/v2/signout`),
  established at login. A long-lived `auth_tkn_nogizaka46.com` JWT cookie
  (httpOnly, `Bearer …`) is the anchor.
- **Refresh (headless):**
  ```
  POST https://api.message.nogizaka46.com/v2/update_token
  headers: content-type/accept json, x-talk-app-id: jp.co.sonymusic.communication.nogizaka 2.5,
           x-talk-app-platform: web, Cookie: <the jar>
  body:    {"refresh_token": null}
  → 200 {"access_token": "<JWT>", "expires_in": 3600}   + Set-Cookie: session=<new> (×2)
  ```
  **`update_token` ROTATES the `session` cookie** — you MUST persist the rotated
  value for the next call (mirrors the mobile refresh_token rotation).
- **Content:** `GET /v2/groups?organization_id=1`, `GET /v2/groups/{id}/timeline?updated_from=<iso>&count=200&order=asc`, `Authorization: Bearer <access_token>`.

Note: sending `session` alone works when fresh; the reliable jar is
`session=<a>; session=<b>; auth_tkn_nogizaka46.com=<jwt>; WAPID=<id>`. The module
keeps the non-session parts and swaps in the rotated `session`s each call.

## Files
- `src/lib/server/nogizaka.ts` — `updateToken()` (refresh + persist rotation),
  `fetchGroups`/timeline paging, `mapTimeline`/`mediaFor` (ported from the
  collector), per-group watermark in `app_state["nogizaka:watermark"]`,
  `collectNogizaka()`. Mirrors `cosm.ts`.
- `src/app/api/fetch/route.ts` — `key: "nogizaka"` branch + included in Fetch-all
  when `isConfigured()` (env `NOGIZAKA_COOKIE` present).

## Config (in `.env.local`)
```
NOGIZAKA_API_BASE=https://api.message.nogizaka46.com
NOGIZAKA_APP_ID=jp.co.sonymusic.communication.nogizaka 2.5
NOGIZAKA_COOKIE="session=…; session=…; auth_tkn_nogizaka46.com=Bearer …; WAPID=…"
```
`NOGIZAKA_COOKIE` is only the **bootstrap seed**. The live, rotating jar is stored
in `app_state["nogizaka:cookie"]` and updated every refresh.

## Bootstrapping / re-bootstrapping the cookie
When the session dies (`update_token` 400: "session expired"), reseed from a
logged-in browser. With the omp relay attached to a logged-in `message.nogizaka46.com`
tab, read the cookies via CDP `Network.getAllCookies` and rebuild the jar:
`session` (×2) + `auth_tkn_nogizaka46.com` + `WAPID` → write to `NOGIZAKA_COOKIE`
(or directly to `app_state["nogizaka:cookie"]`), delete the stale `app_state`
copy, and fetch again.

## ⚠️ Caveat — shared rotating session
The app and a live logged-in browser share the **same** server session, and
whoever calls `update_token` last rotates it out from under the other. So:
- Run the headless pull when you're **not** actively using the mobame web app.
- If you open the web app after a pull (or vice-versa), one side may need a
  re-bootstrap. The mobile `refresh_token` route (colmsg/hashinami-cli, host
  `api.n46.glastonr.net`) avoids this by using an independent credential — switch
  to that if the sharing becomes annoying (needs a one-time mobile-app capture).

## Collector
The collector's browser/CDP `runNogizaka` still exists in the separate
`oshi-inbox-collector` repo and remains a valid fallback for re-bootstrapping, but
is no longer needed for routine pulls — the app does it headless.
