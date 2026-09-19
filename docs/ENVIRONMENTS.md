# Environment tiers & release escalation path

Four tiers, promoted in a fixed order:

```
development  ->  uat  ->  preprod  ->  production
   auto          auto      approval     approval
```

Implemented as one pipeline, `.github/workflows/deploy.yml`:

1. **`build-and-test`** — calls `.github/workflows/ci.yml` (typecheck, test,
   build, both workspaces) as a reusable workflow. Nothing below runs if this
   fails.
2. **`deploy-development`** — deploys automatically once `build-and-test`
   passes. No approval.
3. **`deploy-uat`** — deploys automatically once `deploy-development`
   succeeds. This is where testers/stakeholders do acceptance testing before
   anything is allowed closer to real users. No approval gate on the deploy
   itself — the "approval" for this tier is a human acceptance-testing pass,
   not a pipeline gate.
4. **`deploy-preprod`** — **requires approval.** The job pauses as "Waiting"
   in the Actions UI until a designated reviewer approves the run.
5. **`deploy-production`** — **requires approval.** Same mechanism, its own
   (smaller/stricter) reviewer list. Only runs after `deploy-preprod`
   succeeds.

Each tier's actual deploy step is `scripts/deploy.sh <tier>` — currently a
labeled placeholder (see that file's header) since no hosting provider is
configured yet. The pipeline's structure (build once, promote through
tiers, gate the last two on human approval) works today and doesn't depend
on that; only the "actually push new code to a running server" step does.

## How the approval gate actually works

GitHub Actions' own **Environment protection rules** are the enforcement
mechanism — not custom code in this repo. A job with `environment: preprod`
(or `production`) automatically pauses if that Environment has required
reviewers configured, and only a designated reviewer can unblock it from the
Actions run page ("Review deployments" button). This can't be set up via a
tool call from this session — no GitHub API access here can create Environments
or set their protection rules (that's a repo-admin action gated behind
GitHub's UI/API, not something the automation available in this session has a
path to). **A repo admin has to do this once, by hand:**

1. GitHub repo -> **Settings -> Environments -> New environment**.
2. Create four Environments named exactly `development`, `uat`, `preprod`,
   `production` (must match the names in `deploy.yml`'s `environment:` keys).
3. On `development` and `uat`: leave protection rules off — these deploy
   automatically.
4. On `preprod`: check **Required reviewers**, add the people who should
   approve a pre-production release. Optionally set a **wait timer** too.
5. On `production`: check **Required reviewers**, add a smaller/stricter
   list (e.g. only project owners) than preprod's. Optionally restrict which
   branches can deploy to it under **Deployment branches and tags**.
6. Add each tier's real secrets (`DATABASE_URL`, `STRIPE_SECRET_KEY`, etc. —
   see `deploy/environments/<tier>.env.example` for the full list and
   tier-specific notes) as that Environment's own secrets, not repo-wide
   secrets. This is what actually separates the tiers: preprod and
   production should never share a database or a live Stripe key with a
   lower tier.

Until step 4/5 are done, `deploy-preprod` and `deploy-production` will run
immediately with no gate — the workflow file declares the intent, but the
approval requirement itself lives in that per-Environment setting.

## Why this shape

- **development/uat auto-deploy, preprod/production don't** — fast iteration
  where mistakes are cheap, a deliberate human checkpoint where they're not.
- **Escalation is linear and can't be skipped** — `deploy-production` has
  `needs: deploy-preprod`, so there's no path to production that doesn't
  first pass through an approved preprod deploy (which itself needs a
  successful UAT deploy, which needs a green `build-and-test`).
- **Separate secrets per tier** (via GitHub Environment-scoped secrets,
  rather than one shared `.env`) is what actually prevents a UAT walkthrough
  from touching production data or charging a real card — the tier-specific
  notes in each `deploy/environments/*.env.example` call this out explicitly
  (test-mode Stripe keys through preprod, live keys only in production).
