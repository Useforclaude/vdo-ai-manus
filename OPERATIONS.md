# Cineflow Operating Profile

## Intended Use

This deployment is configured for personal, browser-based video editing without sign-in. The recommended operating profile is **one video at a time**, with each source video no longer than **three minutes**. Under that profile, the project can use Autoscale hosting.

## Processing Flow

The browser uploads the original video to the project's S3-compatible object storage. The application records the storage key and job state in the database, interprets the Thai or English command, then the backend performs FFmpeg and subtitle-transcription work. Completed MP4 and SRT artifacts are written back to the same managed storage and downloaded through an owner-checked attachment endpoint.

> Files, job history, and download permissions are scoped to the browser's `cineflow_guest` cookie. Clearing browser cookies will prevent that browser from seeing its previous job history.

## Autoscale Limits

Autoscale is appropriate for occasional short clips, including a subtitle operation, when the user runs jobs sequentially. It is not the intended choice for multiple concurrent encodes, high-resolution source files that take a long time to process, or a sustained editing workload.

| Situation | Recommended hosting |
|---|---|
| Personal editing; source video ≤ 3 minutes; one job at a time | Autoscale |
| Several users or simultaneous jobs | Reserved Hosting |
| Long, high-resolution, or repeat batch processing | Reserved Hosting |
| Background work that must continue independently of web requests | Reserved Hosting with a durable job queue |

## Storage Retention

Original videos, processed videos, and SRT outputs are retained in project-managed object storage until a deletion or retention feature is added. The current UI does not yet provide deletion or automatic expiry, so do not upload material that must be automatically purged.
