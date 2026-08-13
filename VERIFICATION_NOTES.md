# Cineflow Extension Verification Notes

## Data-access boundary

Active projects are returned only when `deleted_at` is empty and `expires_at` is either empty or in the future. Every Cineflow tRPC procedure and video REST route runs the on-demand expiry sweep before reading or changing a project. This preserves compatibility with Autoscale because expiry cleanup needs no persistent worker.

Deleting a project now marks the project and all associated jobs deleted, removes all clip rows, and clears the project source key and URL plus all processed-output and subtitle keys/URLs. Deleting one job clears only that job's output references. The storage layer has no physical-delete primitive, so this is an access-revocation policy rather than a claim of physical S3 object deletion.

## Rendering boundary

Each clip is downloaded to an isolated temporary workspace, normalized to H.264/AAC at 1280×720 with a silent audio track injected if necessary, and then concatenated in saved sort order. Subtitle requests create an SRT and use FFmpeg's subtitle renderer with a restricted font, size, and position style. The temporary workspace is removed after each job.

## Interface check

Desktop and 375 px mobile previews show the video canvas, clip intake panel, command field, edit history, and status card without horizontal overflow. On narrow screens the source panel, command area, history, and studio-status card stack in their intended priority order while the header hides nonessential navigation.

## End-to-end smoke test

On 13 August 2026, an isolated guest session uploaded two generated MP4 clips into one project, created a 16:9 job with the `Inter`/large/top subtitle-style settings, and completed the multi-clip FFmpeg render. The returned job reached `complete` at 100% with a processed-output storage key. The smoke project was then deleted; the associated download endpoint returned HTTP 404, confirming that the database-level revocation boundary is enforced for a previously completed output.

The repeatable browser smoke script, `pnpm run test:e2e:multiclip`, was also executed successfully against the live development UI. It uploaded two distinct clips through the file input, selected the second clip and confirmed the preview source changed, moved that clip to the first position, displayed and changed all three subtitle-style controls, created and completed an edit, then deleted the project. The script uses an isolated guest browser context and removes its own project at the end of the run.
