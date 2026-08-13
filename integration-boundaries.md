# Video Editor Integration Boundaries

## Current decision

Cineflow executes its editing workflow natively through the project server: S3 stores source and output files, the command interpreter creates a validated edit plan, and FFmpeg/Whisper execute rendering and transcription. This keeps the workflow available without relying on a third-party desktop editor.

## OpenCut

The official OpenCut repository describes the product as a web, desktop, and mobile video editor currently being rewritten. Its public roadmap mentions an MCP server for AI agents as a future capability, but it does not presently provide a documented, production-ready MCP endpoint or API that this web app can safely call. Therefore, no OpenCut connector has been configured.

## CapCut

No CapCut connector is configured for this task. A CapCut integration would require an official API or MCP endpoint plus user-authorized credentials and explicit confirmation before a connector could be proposed. Cineflow should not automate a user’s CapCut account through undocumented endpoints.

## Follow-up condition

When OpenCut publishes an official MCP endpoint or CapCut supplies an appropriate authorized integration, first verify the official documentation and authentication model, then request the user’s approval before creating or enabling a connector.
