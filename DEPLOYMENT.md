# Ivy6 deployment (Render)

This project is configured for a single Render web service: the Express server serves the Vite production build and the `/api/*` endpoints from the same origin. The server includes an SPA fallback so app routes can be refreshed directly.

## Deploy steps

1. Upload this project to a private GitHub repository. Include `render.yaml` at the repository root.
2. In Render, choose **New + → Blueprint** and connect that repository. Render will read `render.yaml` and create the `ivy6` web service.
3. Set `APP_ORIGIN` to the final Render service URL (for example, `https://your-service.onrender.com`).
4. Add the required provider settings in Render's Environment page. Never commit secrets into the repository.
5. Deploy and check `/api/health`, then test the actual routes and integrations.

## Provider configuration required for live integrations

- **Contact email:** `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL`. The recipient is already set to `Glowwithivyx@gmail.com`. A verified sender/domain is required by Resend.
- **AI tools:** `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`).
- **Supabase:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`; apply `supabase/migrations/001_initial.sql` and configure auth redirect URLs/RLS. Do not expose the service-role key to the browser.
- **Admin:** Render generates `ADMIN_API_TOKEN` from the blueprint. This starter's admin endpoint uses a server-side token and is not a complete production staff-role system; strengthen it before allowing real users or moderation data.
- **Job feeds:** the API attempts public Remotive and Arbeitnow feeds. Review their terms, geographic coverage, and commercial-use requirements, then test live results after deployment.

## Important status

No hosting account or deployment credentials are available in this environment, so this configuration cannot itself publish the site to a public URL. The project also has not passed a production build here because package installation timed out. After connecting the repository in Render, inspect build logs and resolve any errors before treating it as live. Provider acceptance is not proof that an email reached the destination inbox.
