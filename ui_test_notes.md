# Browser UI verification notes

- Verified on 2026-08-13 using the Cineflow development URL as an anonymous browser session.
- The header displayed `Ready to edit`; no sign-in control was present, and the page explicitly stated that work is tied to the current browser.
- A small MP4 was selected through the page's hidden file input. After the actor-alignment fix, the page entered the `Uploading securely` state and showed the local video image under its overlay, confirming that the UI upload handler received the file.
- A Thai command, `สร้างซับไตเติลและ crop 16:9`, was entered into the command textarea and the **Create edit** action was invoked.
- The next verification step is to confirm the uploaded project, then create a new edit and inspect the job card, progress, and download controls.
- The uploaded project displayed as `guest-ui-verification.mp4` with a 31 KB badge and an active **Replace** control. The Thai command `สร้างซับไตเติลและ crop 16:9` was entered, and **Create edit** switched to its loading state after it was invoked.
- Database verification confirmed that the UI-created job `job_PmmXf6PVR6Dinlum` belongs to the same guest user (`60003`) as the UI-created project (`90001`) and reached `complete` with `progress = 100` after the subtitle-and-crop run.
- From the rendered history card, **Download video** opened the signed storage URL and rendered the completed MP4 in the browser. **Download SRT** triggered a browser download; Chrome download history recorded `subtitles_514c63cc.srt` from the Cineflow project URL.
- After replacing the direct storage URL with the Cineflow attachment endpoint, **Download video** kept the Cineflow page open when invoked; the next check is Chrome download history to confirm the MP4 was saved rather than rendered inline.
- The browser download directory contains `cineflow-edit-job_PmmXf6PVR6Dinlum.mp4`, confirming that the attachment endpoint saved the rendered MP4 instead of opening the inline player.
