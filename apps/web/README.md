# Synapse Web

Synapse web client foundation based on [shadcn-admin](https://github.com/satnaing/shadcn-admin). The source project's MIT license is retained in `LICENSE`.

This app provides the responsive admin shell and Synapse global account flows: JSON sign-in, session restoration from `/auth/me`, profile updates, password changes, and server-backed logout. Registration and password recovery are not enabled by the API and are presented as unavailable.

## Development

- Install: `pnpm install`
- Start: `pnpm dev`
- Build: `pnpm build`

The web app calls the full API prefix in `VITE_API_BASE_URL` (default `/api/v1`). In development, Vite proxies that prefix to `VITE_API_PROXY_TARGET`, which defaults to `http://127.0.0.1:8010`. Copy `.env.example` to `.env.local` to customize either value. Set the proxy target to the actual Synapse API host/port if it differs from the default.
