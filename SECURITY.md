# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security tab → "Report a vulnerability"**. Include what you found, how to reproduce it, and what it could let someone do.

You can expect a first answer within a few days. This is a small, volunteer-run project: there is no bug bounty, but
you will be credited if you wish.

## What is in scope

- The Worker in [`worker/`](worker) (authentication, usage limits, the TMDB allow-list, prompt handling).
- The Firestore rules in [`firebase/firestore.rules`](firebase/firestore.rules): anything that lets one account read or
  change another account's lists, notes or sessions.
- The desktop and Android apps (for example, ways to make them leak a token or run untrusted content).

## How the project protects data

- **Secrets live in one place:** the Worker (Cloudflare secrets). The apps hold no TMDB, Gemini or RapidAPI key.
- **Accounts need a verified email.** The Worker and the Firestore rules both refuse unverified accounts.
- **Lists and notes are private to their owner.** Watch Together shares only a short-lived summary of titles, genres and ratings between the two members of a session; notes are never shared.
- **The Worker builds every AI prompt itself** and only reads whitelisted fields, so the shared Gemini key cannot be used as a general chatbot. It also limits usage per account and in total.

## Things that look like secrets but are not

The Firebase web configuration (`apiKey`, `projectId`, `appId` in `desktop/src/renderer/src/config.ts`) and
`mobile/app/google-services.json` are **public by design**: they only say which Firebase project to talk to, and they are in
every installed copy of the apps. Access is enforced by the Firestore rules and the sign-in, not by hiding them.
Reports about these values being visible will be closed, but a rule that is too permissive is exactly what we want to hear about.

## Running your own copy

If you deploy your own backend, set your own secrets with `wrangler secret put` and never commit `.env`, `.dev.vars` or `local.properties` (all git-ignored).
