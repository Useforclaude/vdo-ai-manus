# Cineflow Waveform Design

## Goal

Waveform is an **editing aid**, not an audio-processing artifact. It gives the guest user a visual signal for speech and quiet passages while choosing `trimStartMs` and `trimEndMs` for the currently selected clip. It must not create, persist, or upload another audio file.

## Ownership and retrieval boundary

The existing clip preview URL is already scoped to the active guest session by the project and clip APIs. The browser will use that approved preview URL only after the selected clip has been returned from `video.listClips` for an active project. No public storage URL, cross-project identifier, or untrusted filename is accepted as a waveform source.

## Client-side extraction flow

1. The user selects a clip that they own from the timeline.
2. The browser fetches the selected clip using its authorized preview URL.
3. `AudioContext.decodeAudioData()` decodes the audio track in memory. If a file has no audio track or the browser cannot decode it, the timeline displays a compact unavailable state and keeps numeric trimming controls usable.
4. The renderer reduces the decoded samples into a fixed 96-bin array of peak magnitudes. Each bin is normalized to `0…1`; only this small derived array remains in React state.
5. A semantic SVG or CSS bar chart draws the peaks. The selection window overlays the waveform and maps the existing millisecond trim bounds to the source duration.

## Safety, privacy, and performance

The implementation never sends extracted samples to the server or S3. It limits rendering to 96 bins and releases the `AudioBuffer` reference after peak extraction. It loads peaks only for the currently selected clip, cancels stale requests when selection changes, and has a clear empty state for silent, unsupported, or audio-free clips. The server-side FFmpeg trim remains the source of truth for exported video.

## Test boundary

Unit tests verify peak reduction for known sample vectors and the no-audio fallback. Browser E2E verifies that selecting a clip renders the waveform or the explicit unavailable state, and that trim controls still persist correctly.
