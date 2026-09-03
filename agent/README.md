# Atlas boot templates

These files are the lean, public source for Atlas's operating contract. Deploy a
reviewed copy into the agent workspace; do not put credentials, Discord IDs,
private documents, network names, or live configuration here.

The runtime loads `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, and `USER.md` at boot.
`COLLABORATION.md` is retrieved only when Atlas coordinates with the personal
agent. Codex remains the author; Atlas may propose changes but does not deploy
changes to its own authority.
