# Atlas report bridge

The bridge turns one validated report object into two views:

- `/r/<report-id>` is responsive HTML for Discord links on a phone, tablet, or PC.
- `/api/reports/<report-id>` is the canonical JSON that an agent can read and continue working from.

Both files are generated together from the same object. Report text is escaped, citations are validated, source URLs cannot carry credentials, files are private by default, and the server is read-only with no directory listing.

## Local test

```bash
npm test
node render-report.mjs example-report.json ./reports
ATLAS_REPORT_DIR=./reports node server.mjs
```

The server refuses non-loopback binds. Remote access must come through a private Tailscale Serve path and should remain governed by tailnet access policy. Do not use Tailscale Funnel.

Automated validation currently passes nine tests. A live local preview also passed at 390-pixel phone width and 820-pixel tablet width with no horizontal overflow. The service is not yet installed or exposed through Tailscale Serve.

## Planned OpenClaw integration

Atlas will normalize a completed answer and citations into `report.schema.json`, materialize the pair on the report host, and post the private HTML link to Discord. Short conversational replies can remain in Discord; long research, comparisons, plans, and evidence-heavy answers should use the bridge.
