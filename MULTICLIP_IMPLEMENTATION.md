# Cineflow multi-clip implementation design

## Target operating profile

This extension keeps Cineflow in its intended operating profile: one guest browser session, one editing job at a time, and a finished timeline of no more than three minutes. A project may contain up to 12 clips. The aggregate source-size and duration limits are enforced before a job is accepted.

## Data model

`video_projects` remains the user-owned editing container. Its existing source fields are retained for backward compatibility with earlier single-clip projects. New projects use `video_clips` as the authoritative ordered collection, with `sort_order`, original filename, MIME type, bytes, storage key, and URL. A legacy project without rows in `video_clips` is treated as a project with its existing source file as its only clip.

Each `edit_jobs` record stores a typed subtitle style snapshot. That makes output reproducible if a user later changes controls for a new job. The style has a constrained font family, font-size preset, and screen position; arbitrary filesystem paths and arbitrary FFmpeg filter text are never accepted from the client.

Projects gain `expires_at` and `deleted_at`. A deletion or expiry revokes access by excluding the project, its clips, and its jobs from all user-scoped reads and download checks.

## Editing workflow

The processor downloads every selected clip into an isolated temporary workspace, normalizes them to a common H.264/AAC stream, and joins them into one timeline using FFmpeg. Existing trim, silence-removal, crop, and subtitle workflows then operate against that timeline. When subtitles are requested, the generated SRT is preserved and also burned into the rendered MP4 using a server-side ASS style derived from the saved subtitle-style snapshot.

## Storage retention boundary

The provided project storage interface supports object upload and signed retrieval but does not expose an object-delete primitive. Therefore the application implements **access revocation**: it removes storage keys and URLs from active records, excludes deleted or expired records from all API reads, and prevents download endpoints from resolving signed URLs. This satisfies browser-level privacy and access control, but it is not a claim of physical object deletion from the managed storage provider.

The expiry sweep is idempotent and runs when a Cineflow request is handled. It does not rely on a permanently running worker, which keeps the feature compatible with Autoscale. An eventual provider-side physical lifecycle policy would require a storage integration that exposes lifecycle or object-delete controls.

## User experience

The upload surface creates a project from the first clip and lets the user add clips. The clip list displays order controls, a selected preview, and a remove action. The command panel applies to the assembled timeline. Subtitle controls offer constrained choices: `Noto Sans Thai`, `Arial`, or `Inter`; small, medium, or large; and bottom, middle, or top. The history area offers project deletion and retention selection, with a plain-language notice that deletion immediately removes access in Cineflow.
