# Cloud generation verification

The production implementation uses Vercel Workflows. See
[Vercel generation verification](vercel-generation-verification.md) for deployment and live
results, and [Generation on Vercel](../roadmaps/cloud-generation.md) for configuration.

The retained local service is an integration-test harness for the kiosk protocol. Its tests
cover twenty queued submissions, idempotency, owner isolation, lost-response discovery,
restart reconciliation, corrupt-download recovery, atomic installation, and deletion
tombstones. They do not establish twenty simultaneous real-provider generations or Pi
playback performance. The earlier Render/Docker deployment approach has been removed.
