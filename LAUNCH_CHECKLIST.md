# THREAD publication checklist

Use this tomorrow. Do not mark an item complete from memory.

## Secrets and sponsors

- [ ] Confirm `.env` is mode 600 and remains gitignored.
- [ ] Activate Fireworks billing; run `POST /api/integrations/verify`; require
      `fireworks.state === "ready"` before advertising live VLM extraction.
- [ ] Confirm OpenRouter has usable quota for both configured model IDs.
- [ ] Confirm the ElevenLabs agent is still named `THREAD Witness Interviewer`
      and a signed URL starts a browser session.
- [ ] Rotate any sponsor credential that may have entered shell history or a
      screen recording; never paste values into docs.

## Clean local proof

```bash
pnpm install --frozen-lockfile
pnpm atlas:up
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
curl -s http://127.0.0.1:8787/api/health | jq
```

- [ ] All seven Atlas capabilities show active.
- [ ] OpenRouter and ElevenLabs show ready; Fireworks shows ready or is described
      honestly as blocked.
- [ ] Run Who is “J”? and confirm packet method `atlas-rank-fusion` after index
      freshness plus a non-null checkpoint ID.
- [ ] Run Evidence 143 and inspect the 81 → 48 / 41 → 73 revision.
- [ ] Upload a text/PDF and inspect raw locator, SHA-256, claim provenance.
- [ ] Run one image and one audio artifact with the intended live providers.
- [ ] Recheck desktop and 390 px viewport, keyboard focus, reduced motion, and
      browser console warnings.

## Public runtime

- [ ] Select a host for the web/API and a production MongoDB deployment.
- [ ] Set secrets only in the host's encrypted server environment.
- [ ] Update allowed CORS origin and OpenRouter referer from loopback to the real domain.
- [ ] Add TLS, health/readiness checks, structured logs, backup/retention policy,
      upload storage, request size/rate limits, and authentication.
- [ ] Disable or segregate the synthetic demo reset endpoint in a real case environment.
- [ ] Verify the exact public SHA, clean working tree, public HTTPS render, API
      health, one provider call, one checkpoint, and one persisted mutation.

## Claims boundary

- [ ] Say “local proof” until public HTTPS and hosted persistence are exercised.
- [ ] Never call a configured credential active without a live response.
- [ ] Never call a unit, build, health route, or screenshot an end-to-end proof by itself.
- [ ] Keep the permanent decision-support / not-admissible-evidence notice visible.
