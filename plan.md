# “blue.snippet.code” MVP — **Implementation Blueprint (Workers edition, local-first feedback loops)**

_Rev 6 · 16 May 2025 · MIT_

This version **drops Cloudflare Pages** and deploys everything to **Cloudflare Workers** using **OpenNext (`@opennextjs/cloudflare`)**.  
All tests (Vitest + Playwright) run _locally_; the only remote automation is Workers’ Git deploy.

---

## 0 · Prereqs

| item              | value                                     |
| ----------------- | ----------------------------------------- |
| Cloudflare acct   | free-tier                                 |
| Bluesky test user | `test_snippet.bsky.social` + app-password |
| Secrets           | 32-byte hex `APP_PWD_KEY` (AES-GCM)       |
| Toolchain         | pnpm ≥8, Node ≥20, git                    |

---

## 1 · Atomic Steps ＋ Local Validation

|      # | deliverable                                          | build / deploy                                                                        | **local test / feedback loop**                                                                                   |
| -----: | ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
|  **1** | **Scaffold** (Next + Workers)                        | `pnpm create cloudflare@latest blue-snippet-code --framework=next --platform=workers` | `pnpm run dev` → browser shows default Next page                                                                 |
|  **2** | **Lexicon** file                                     | add `lexicons/blue.snippet.code.snippet.json` (§3)                                    | `pnpm add -D @atproto/cli` → `pnpm lex:gen` → `node -e "require('./src/lexicon-types');console.log('types ok')"` |
|  **3** | **Test-publish** script                              | `scripts/create-test-snippet.ts` (code §6-A)                                          | `pnpm tsx scripts/create-test-snippet.ts` → snippet shows on Bluesky web                                         |
|  **4** | **Cloudflare resources**                             | `wrangler d1 create snippet-index` + KV namespaces                                    | `wrangler d1 execute snippet-index --command "SELECT 1;"` returns `1`                                            |
|  **5** | **Migration #1**                                     | SQL file §4; `wrangler d1 migrations apply snippet-index`                             | `.schema idx` prints table + index                                                                               |
|  **6** | **Durable Object skeleton**                          | code compiles; `wrangler dev --local`                                                 | `curl 127.0.0.1:8787/start` → “started”                                                                          |
|  **7** | **Jetstream connect**                                | add logic (§6-B)                                                                      | terminal logs “connected”; run script #3 → log shows `onCreate` fired                                            |
|  **8** | **Write rows to D1**                                 | SQL in `onCreate`                                                                     | run script again → `COUNT(*)` in D1 increments                                                                   |
|  **9** | **Cron self-heal**                                   | cron in `wrangler.json`; `wrangler deploy`                                            | break WS 1 min, restore; hourly cron logs “started”                                                              |
| **10** | **Worker API** (`/api/snippets` etc.)                | handler code (§6-C)                                                                   | `wrangler dev --preview` → `curl /api/snippets` returns JSON                                                     |
| **11** | **KV cache** for full record                         | call `/api/snippet/:did/:rkey` twice → KV reads == 1                                  |
| **12** | **Custom worker entrypoint** (routes API → OpenNext) | `src/worker.ts` (§6-D)                                                                | `pnpm run preview` → homepage still renders                                                                      |
| **13** | **Next.js homepage** (Edge)                          | list ≤ 25 snippets w/ highlight                                                       | `pnpm run preview` → browser view                                                                                |
| **14** | **Snippet page** `/s/[did]/[rkey]`                   | full highlight OK                                                                     |
| **15** | **Login + /new modal**                               | encrypt app-pwd; POST record                                                          | post via UI → Bluesky & homepage update                                                                          |
| **16** | **Rate-limit 10/min**                                | loop 11 POSTs → 11ᵗʰ = HTTP 429                                                       |
| **17** | **Playwright smoke**                                 | `pnpm e2e` (local worker preview) passes                                              |
| **18** | **Alerts** (requests, DO duration, exceptions)       | inject error; email arrives                                                           |
| **19** | **v1 alpha tag**                                     | `git tag v1.0.0-alpha`                                                                | ready for feedback                                                                                               |

---

## 2 · `wrangler.json` (Workers + OpenNext)

```jsonc
{
  "name": "blue-snippet-code",
  "main": "src/worker.ts", // custom entrypoint (§6-D)
  "compatibility_date": "2025-05-16",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    // served by OpenNext
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "kv_namespaces": [
    {
      "binding": "SNIPPET_CACHE",
      "id": "XXXXXXXXXXXX",
      "preview_id": "XXXXXXXXXXXX"
    },
    {
      "binding": "APP_PASSWORDS",
      "id": "YYYYYYYYYYYY",
      "preview_id": "YYYYYYYYYYYY"
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "snippet-index",
      "database_id": "ZZZZZZZZZZZZ"
    }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "FirehoseIngestor", "class_name": "FirehoseIngestor" }
    ]
  },
  "triggers": { "crons": ["0 * * * *"] }, // hourly
  "vars": {
    "HIGHLIGHT_LANGS": "js,ts,py,go,rust,java,cpp,cs,php,rb,swift,kotlin,scala,sh,html,css,json,yaml,toml,sql,md,tex,rs,hs,elixir,erlang,clj,ps1,zsh,lua"
  }
}
```
````

Add secret: `wrangler secret put APP_PWD_KEY`

---

## 3 · Lexicon

`lexicons/blue.snippet.code.snippet.json`

```jsonc
{
  "lexicon": 1,
  "id": "blue.snippet.code.snippet",
  "revision": 1,
  "type": "record",
  "key": "didSelf",
  "description": "A single code snippet",
  "record": {
    "required": ["name", "lang", "code", "createdAt"],
    "properties": {
      "name": { "type": "string", "maxLength": 200 },
      "desc": { "type": "string", "maxLength": 1000 },
      "lang": { "type": "string" },
      "code": { "type": "string", "maxLength": 8192 },
      "createdAt": { "type": "string", "format": "datetime" }
    }
  }
}
```

Generate types:  
`pnpm lex:gen` → outputs `src/lexicon-types.ts`

---

## 4 · D1 Migration #1

`migrations/20250516T0001_init.sql`

```sql
CREATE TABLE idx (
  did       TEXT NOT NULL,
  rkey      TEXT NOT NULL,
  name      TEXT NOT NULL,
  lang      TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  PRIMARY KEY (did, rkey)
);
CREATE INDEX idx_createdAt_desc ON idx (createdAt DESC);
```

---

## 5 · OpenNext integration

### `open-next.config.ts`

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
export default defineCloudflareConfig({
  // optional cache overrides here
});
```

### `package.json` scripts

```jsonc
{
  "scripts": {
    "dev": "next dev",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
    "lex:gen": "atproto lexicons:generate --output src/lexicon-types.ts lexicons/**/*.json",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}
```

---

## 6 · Key Code Artefacts

### 6-A · Test-publish script

```ts
// scripts/create-test-snippet.ts
import { BskyAgent } from "@atproto/api";
import { randomBytes } from "node:crypto";
import "dotenv/config";

const agent = new BskyAgent({ service: "https://bsky.social" });
await agent.login({
  identifier: process.env.TEST_BSKY_HANDLE!,
  password: process.env.TEST_BSKY_APP_PWD!,
});

await agent.api.com.atproto.repo.createRecord({
  repo: agent.session!.did,
  collection: "blue.snippet.code.snippet",
  record: {
    name: "Hello World",
    lang: "ts",
    code: `console.log('${randomBytes(4).toString("hex")}');`,
    createdAt: new Date().toISOString(),
  },
});
console.log("snippet posted");
```

### 6-B · Durable Object `FirehoseIngestor`

```ts
// src/firehose.ts
import { Jetstream } from "@skyware/jetstream";
import type { BlueSnippetCodeSnippet } from "./lexicon-types";

export class FirehoseIngestor {
  private jet?: Jetstream<["blue.snippet.code.snippet"]>;
  private cursor?: bigint;

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request) {
    if (new URL(req.url).pathname === "/start") {
      await this.start();
      return new Response("started");
    }
    return new Response("404", { status: 404 });
  }

  private async start() {
    this.cursor = (await this.state.storage.get<bigint>("cursor")) ?? undefined;

    this.jet = new Jetstream({
      endpoint: "wss://jetstream.bsky.network/subscribe",
      wantedCollections: ["blue.snippet.code.snippet"],
      cursor: this.cursor,
    });

    this.jet.onCreate("blue.snippet.code.snippet", this.onCreate);
    this.jet.on("close", () => this.reconnect());
    this.jet.on("error", () => this.reconnect());

    this.jet.start();
    setInterval(() => this.jet?.send?.("ping"), 15_000);
  }

  private onCreate = async (ev: {
    record: BlueSnippetCodeSnippet;
    did: string;
    commit: { rkey: string };
    cursor: bigint;
  }) => {
    await this.env.DB.prepare(
      "INSERT OR IGNORE INTO idx (did,rkey,name,lang,createdAt) VALUES (?,?,?,?,?)"
    )
      .bind(
        ev.did,
        ev.commit.rkey,
        ev.record.name,
        ev.record.lang,
        ev.record.createdAt
      )
      .run();

    if (ev.cursor % 1000n === 0n)
      await this.state.storage.put("cursor", ev.cursor);
  };

  private reconnect() {
    setTimeout(() => this.start(), 5_000);
  }
}
```

### 6-C · API Handler

```ts
// src/api.ts
export async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/snippets") {
    const limit = Number(url.searchParams.get("limit") || "25");
    const { results } = await env.DB.prepare(
      "SELECT * FROM idx ORDER BY createdAt DESC LIMIT ?"
    )
      .bind(limit)
      .all();
    return Response.json(results);
  }

  const m = url.pathname.match(/^\/api\/snippet\/([^/]+)\/([^/]+)$/);
  if (m) {
    const key = `snippet:${m[1]}:${m[2]}`;
    const cached = await env.SNIPPET_CACHE.get(key, "json");
    if (cached) return Response.json(cached);

    const agent = getAgent(); // memoised singleton
    const rec = await agent.api.com.atproto.repo
      .getRecord({
        repo: m[1],
        collection: "blue.snippet.code.snippet",
        rkey: m[2],
      })
      .then((r) => r.data);

    await env.SNIPPET_CACHE.put(key, JSON.stringify(rec), {
      expirationTtl: 86_400,
    });
    return Response.json(rec);
  }

  return new Response("Not found", { status: 404 });
}
```

### 6-D · **Custom worker entrypoint** — glue API + OpenNext + DO

```ts
// src/worker.ts
import handleNext from "./.open-next/handler";
import { handleApi } from "./api";
export { FirehoseIngestor } from "./firehose";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    return handleNext(request, env, ctx);
  },
};
```

### 6-E · AES-GCM helper for app-passwords

```ts
export async function encrypt(plain: string, keyHex: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(keyHex, "hex"),
    "AES-GCM",
    false,
    ["encrypt"]
  );
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain)
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(cipher).toString(
    "base64"
  )}`;
}
```

---

## 7 · Local Testing Commands

| layer              | command                                       |
| ------------------ | --------------------------------------------- |
| unit (Vitest)      | `pnpm test`                                   |
| worker (Miniflare) | `pnpm tsx tests/worker.spec.ts`               |
| e2e (Playwright)   | `pnpm e2e` (runs against `pnpm run preview`)  |
| publish + assert   | `pnpm tsx scripts/publish-test-and-assert.ts` |

---

## 8 · Ops Quick-start

1. `pnpm run deploy` — OpenNext builds & `wrangler deploy` pushes Worker, DO, migrations.
2. Dashboard → Workers → **tail** logs.
3. Alerts:
   - requests ≥ 90 k/day
   - DO duration ≥ 8 M s/month
   - exceptions > 20 / 5 min → email
4. Hourly cron invokes DO `/start`; keep firehose alive.

---

### Hand-off

Work through steps **1 → 19**; each ends with a local check so you never move ahead of a failure.  
Outcome: fully deployable, observable MVP on Cloudflare Workers free tier.

# IMPORTANT NOTE

Step 1 is already done, the project has been created and is deployed to CloudFlare.
