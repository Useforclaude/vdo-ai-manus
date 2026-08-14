# Cineflow Self-Hosting Guide

This package runs Cineflow on infrastructure you control. The web application, guest sessions, MySQL database, video objects, FFmpeg processing, MCP endpoint, and capability-token audit log stay inside the deployment boundary you select. It does **not** require a platform login or a platform storage, LLM, or transcription credential at runtime.

> Cineflow remains a browser-scoped guest editor by default. Anyone who can open the deployed site can create a separate guest workspace, so place it behind your network, SSO proxy, VPN, or another access-control layer if it is not for private use only.

## Deployment topology

| Component | Default Compose service | Responsibility | Persistent data |
| --- | --- | --- | --- |
| Application | `app` | React interface, Express/tRPC API, MCP HTTP endpoint, FFmpeg processing | None; processing work uses temporary storage |
| Database | `db` | Projects, clips, jobs, guest identities, MCP tokens, audit log | `cineflow-mysql-data` volume |
| Object storage | `minio` | Source videos, exports, and subtitle files through an S3-compatible API | `cineflow-minio-data` volume |
| Bucket bootstrap | `minio-init` | Creates the named bucket once before the app starts | None |
| Reverse proxy | Your choice | TLS, public hostname, optional SSO or IP restrictions | Proxy-specific |

The app exposes only relative media URLs such as `/api/media?key=...`. The server checks the browser guest owner before serving a local object or issuing a short-lived S3 redirect, rather than persisting a public object URL in the browser.

## First deployment

Copy the configuration template, replace every placeholder password or key, and choose endpoints for AI services that you control. `CINEFLOW_LLM_BASE_URL` and `CINEFLOW_TRANSCRIPTION_BASE_URL` use OpenAI-compatible paths. The application appends `chat/completions`, `models`, and `audio/transcriptions` to those base URLs.

```bash
cp selfhost.env.template .env
docker compose up -d --build
docker compose exec app pnpm drizzle-kit migrate
```

After migration completes, visit `http://YOUR_SERVER:3000`. For a public deployment, put a TLS reverse proxy in front of the app, set `CINEFLOW_PUBLIC_URL` to the external HTTPS address, and set `CINEFLOW_COOKIE_SECURE=true` before restarting the app.

| Environment group | Required for | Notes |
| --- | --- | --- |
| `DATABASE_URL`, `MYSQL_*` | Project and job persistence | Keep the database password outside source control. The URL must use the Compose service name `db` when deployed with this file. |
| `S3_*`, `CINEFLOW_STORAGE_DRIVER=s3` | Durable source and output video storage | The included MinIO service is suitable for a single-host deployment. Point these values to AWS S3, Cloudflare R2, Backblaze B2 S3 API, or another S3-compatible service if preferred. |
| `CINEFLOW_LLM_*` | Command interpretation and AI Producer | Use a provider account or a self-operated OpenAI-compatible gateway. If omitted, basic keyword fallback still interprets supported commands, but AI Producer cannot generate a model-based plan. |
| `CINEFLOW_TRANSCRIPTION_*` | Subtitle/SRT generation | Provide an OpenAI-compatible Whisper transcription endpoint. |
| `CINEFLOW_COOKIE_SECURE` | Browser session safety | Use `true` only behind HTTPS; development over `http://localhost` requires `false`. |

## Moving existing data

The existing hosted project contains database rows and S3 objects. A migration must preserve the MySQL tables and every referenced storage object together; moving only database rows will leave the project without source media. Export the existing database through the database administration interface, copy the object keys into the destination bucket while retaining their keys, then import the SQL into MySQL.

If you prefer a clean start, deploy the stack with empty volumes. Cineflow creates guest identities and new project records when a browser first uses the editor. Existing MCP capability tokens should be revoked and re-created after any migration because their raw values are deliberately never stored.

## Operational boundaries

The Compose file runs one application process. Cineflow is suited to the existing limit of short videos of up to three minutes and low concurrency. FFmpeg work is CPU- and memory-intensive; for regular concurrent jobs, run separate worker processes and a durable queue before increasing exposure. Back up both named volumes or replace MySQL/MinIO with managed services that have backups and lifecycle policies.

| Routine | Recommended action |
| --- | --- |
| Database backup | Use a scheduled `mysqldump` or managed MySQL backups, encrypt the archive, and test restoration. |
| Object backup | Replicate the MinIO bucket or use S3 versioning and a lifecycle policy in your chosen provider. |
| Token hygiene | Issue MCP tokens per project with the minimum scope, choose expirations, and revoke tokens no longer required. |
| Software upgrade | Pull the intended source version, run `docker compose build`, apply `pnpm drizzle-kit migrate`, then restart `app`. |

## Verifying the installation

Run `docker compose ps` to confirm that `db`, `minio`, and `app` are healthy or running. Upload a short test video, ask Cineflow for a non-destructive trim, and download the result. If subtitles are enabled, verify that an SRT is produced. Finally, create a short-lived MCP `read` token, call `cineflow_timeline`, and confirm that the project audit log records the call without source URLs or storage keys.

## Boundaries of this package

This repository now contains portable runtime adapters and local deployment assets. The development workspace can still include framework-only source files that are not imported by the production entrypoint; they are not required to build or run the self-hosted stack. The `Dockerfile` builds the production frontend and server directly, installs FFmpeg and Noto fonts, and starts the bundled Express application with `PORT` supplied by the host.
