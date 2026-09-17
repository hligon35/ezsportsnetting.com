# EZ Sports Netting on Cloudflare

The migration branch uses one Cloudflare Worker for the static storefront and API, D1 for application data, and Resend for transactional email. Render, SendGrid, and the legacy MailChannels worker are no longer part of this deployment path.

## First deployment

From the repository root:

    npm install
    npx wrangler d1 migrations apply ezsports-prod --remote --config cloudflare/wrangler.toml
    npx wrangler secret put JWT_SECRET --config cloudflare/wrangler.toml
    npx wrangler secret put ADMIN_EMAILS --config cloudflare/wrangler.toml
    npx wrangler secret put RESEND_API_KEY --config cloudflare/wrangler.toml
    npx wrangler secret put RESEND_FROM --config cloudflare/wrangler.toml
    npx wrangler secret put STRIPE_SECRET_KEY --config cloudflare/wrangler.toml
    npx wrangler secret put STRIPE_WEBHOOK_SECRET --config cloudflare/wrangler.toml
    npx wrangler secret put STRIPE_PUBLISHABLE_KEY --config cloudflare/wrangler.toml
    npx wrangler deploy --config cloudflare/wrangler.toml

RESEND_FROM must use a sender address from a verified Resend domain. API keys, Stripe keys, JWT secrets, and Turnstile secrets belong in Worker Secrets, not in wrangler.toml.

## Import existing JSON data

The current repository contains JSON collections from the Render-era application. Review the generated SQL locally before applying it, especially the users and orders collections:

    node cloudflare/scripts/export-json-to-sql.mjs > /tmp/ezsports-import.sql
    npx wrangler d1 execute ezsports-prod --remote --file=/tmp/ezsports-import.sql --config cloudflare/wrangler.toml

Do not commit the generated SQL file. Rotate any credentials that were ever stored in the public repository before importing production data.

## Stripe webhook

After deployment, point the Stripe webhook to:

    https://www.ezsportsnetting.com/webhook/stripe

The Worker validates the Stripe signature, marks the D1 order paid, and sends customer/internal notifications through Resend.

## Custom domain

Attach both ezsportsnetting.com and www.ezsportsnetting.com to the Worker. The Worker redirects the apex host to the canonical www host. The sitemap, robots file, and page canonicals use the same canonical host.

## Local development

    npx wrangler dev --config cloudflare/wrangler.toml

Copy .dev.vars.example to .dev.vars and fill in test credentials. Never commit .dev.vars.
