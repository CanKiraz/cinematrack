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

## Dependency alerts

The installed apps are kept free of known vulnerabilities in what they ship:

- `npm audit --omit=dev` reports **0** for the desktop app, and the installer contains no `node_modules` at all. The UI is bundled
  by Vite, and SQLite comes with Electron itself (`node:sqlite`), so there is no native module either.
- Electron is kept on a supported major (44), which is where most advisories used to come from.
- The Worker has no open alerts.

A few alerts remain **dismissed** in GitHub's Dependabot list, each with its reason written on the alert:
Tailwind 3's and electron-builder's build-time helpers, the Firebase emulator and test tools, and the Node-only parts of the Firebase 10 SDK
(`undici`, `grpc-js`). None of them is part of a shipped app, and the built bundles do not reference them.
Updating Firebase to a newer major would remove the last group; Tailwind 4 would restyle the whole UI, so it waits for a good reason.

## Running your own copy

If you deploy your own backend, set your own secrets with `wrangler secret put` and never commit `.env`, `.dev.vars` or `local.properties` (all git-ignored).
