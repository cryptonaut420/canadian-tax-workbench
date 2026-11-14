# Tax Workbench

Read .data/owner-instructions.md when present, API.md and docs/AGENT-PREPARATION.md before preparing taxpayer data or changing preparation workflows. The desktop Copy agent instructions action and GET /v1/agent-instructions supply the same current guide with the actual local URL and preparation token.

Keep taxpayer data, credentials, live payloads, receipts and private audit copies under .data. Do not put them in source fixtures, screenshots delivered to the user, source archives or public documentation. Use synthetic identities in tests.

Keep annual returns independent. Profiles supply defaults to new returns only. Reuse recorded owner decisions and estimates; do not invent missing facts, force a target balance, fabricate eligibility flags or claim independent verification that was not performed. Agents may record or renew decisions and acknowledgements from the owner’s explicit instructions; do not ask the owner to repeat facts already supplied. Preserve actual legal partnership ownership separately from explicitly agreed profit/loss allocations.

Preserve original yearly calculation modules and rounding semantics. Compare any native orchestration or extension changes against original calculations, previews and offline serialization. Unchanged totals alone do not establish full tax parity. Check current input revisions, preparation and filing-input issues, original checks, schema validation, financial differences, inactive inputs and owner confirmations.

Calculation, validation and PDF generation stay offline. Trusted agents have full API capability: preparation, decisions, acknowledgements, review, settings, terms, plans and submission. Use the owner’s authorization and cite it as provenance. Apply the current user’s explicit scope; this file grants no standing authorization to prepare, review or transmit someone’s return. Do not transmit a return unless the user explicitly asks to send it. Keep ambiguous outcomes blocked and never retry filing automatically. UI fields are intentionally visible at the owner's request, including SIN and NETFILE access codes.

Run tests appropriate to changed behavior. The full backend command is npm test; renderer checks live in scripts/test-ui*.mjs and may use an installed JSDOM_PATH. Exclude .data, .runtime, node_modules, bin, obj and caches from source packages.
