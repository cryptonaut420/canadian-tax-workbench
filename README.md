# Tax Workbench Canada

**Prepare Canadian tax returns with a local desktop app and an API your AI agents can use.**

Tax Workbench Canada combines an Electron interface, SQLite storage and native
.NET calculation hosts. It runs on Linux without Wine or Windows. Prepare several
people and years in one workspace, let an agent handle repetitive data entry,
then review the calculations and forms before filing.

The application and adapter source is MIT licensed. This repository also includes
third-party GenuTax calculation modules and extracted resources with **separate
upstream terms**; they are not relicensed as MIT. See [Third-party notices](THIRD_PARTY_NOTICES.md).

## What it does

- **Multiple people and tax years.** Separate profiles, per-year overrides,
  searchable return lists, income/balance totals and an autosaving person notepad.
- **Agent-first preparation.** Authenticated REST API, OpenAPI documentation,
  revision checks, batch imports and a copyable preparation guide.
- **Native calculations for 2019–2025.** Year-specific managed calculation
  modules run under .NET on Linux. The original calculation instructions are
  preserved; Workbench extensions and serialization adjustments are documented.
- **Employment, investment and business inputs.** Structured slips, RRSP
  receipts, sole proprietorships, partnerships, inventory, home-office inputs,
  CCA schedules and crypto capital-gain schedules.
- **T5013 imports.** Year-specific monetary and descriptive box types, including
  boxes 040, 114, 115, 116 and 118, country fields and explicit COVID-assistance
  treatment. Link a slip to archived business books to avoid double counting.
- **Reviewable output.** Original-layout form previews, supporting schedules,
  PDF review packs and input/calculation history.
- **Durable filing records.** NETFILE/ReFILE workflows, reviewed-snapshot checks,
  explicit final confirmations and saved CRA acknowledgements. Uncertain outcomes
  block automatic retries; sending a request does not itself mark a return filed.

This is an experimental community project, **not CRA-certified software** and
not affiliated with CRA or GenuSource. Upstream certification does not transfer
to this application. A passing schema check is not proof of tax correctness or
filing eligibility. Verify current CRA requirements before live use. Some complex
source combinations and full form/return parity remain unverified.

## Run it locally

Tested on Linux Mint 22.3 / x86-64. You need:

- Node.js **24.15 or newer** (the API uses built-in `node:sqlite`).
- **.NET 10 SDK** to build and run the native hosts.
- Electron and the usual desktop libraries for your Linux distribution.

```bash
git clone https://github.com/cryptonaut420/canadian-tax-workbench.git
cd canadian-tax-workbench
npm install --save-dev electron
npm start
```

The launcher uses an installed Electron runtime, `ELECTRON_BINARY`, or an existing
local Electron cache. On first start the native .NET hosts build automatically.
The supplied yearly runtime assets are included; no Wine installation is needed.

The app starts a loopback API and connects its desktop window to it. To run just
the API instead:

```bash
npm run dev
```

Keep the existing `TAX_WORKBENCH_DATA_DIR` environment variable to choose a
private workspace directory. Its default for development is `.data/` beside the
source. The public-facing rename does not move or replace existing workspaces.

## Prepare your first return

1. Add a person and set their profile defaults.
2. Add a tax year. Choose an initial filing or amendment based on the actual
   filing history; defaults do not replace year-specific source facts.
3. Enter slips and business records directly, use the guided interview, or copy
   the **Agent API** instructions to your authorized agent.
4. Calculate, inspect the lines and forms, resolve applicable checks and mark the
   current snapshot reviewed. Editing inputs requires recalculation and review.
5. Validate offline. Live submission is off by default; enable it in Settings
   only when appropriate, then review and explicitly confirm the transmission.
6. Retain the acknowledgement and supporting records. For a pending or unknown
   outcome, check CRA before any further attempt.

## Use it with an AI agent

Open **Agent API** in the app and use **Copy agent instructions**. The generated
guide supplies the actual local URL and private agent token.

```bash
# Obtain these values from your own running workspace. Do not commit the token.
export WORKBENCH_URL="http://127.0.0.1:YOUR_PORT"
export WORKBENCH_TOKEN="YOUR_PRIVATE_AGENT_TOKEN"

curl -H "Authorization: Bearer $WORKBENCH_TOKEN" \
  "$WORKBENCH_URL/v1/openapi.json"
```

Use decimal strings for money. Read current revisions before modifying returns;
prefer structured endpoints and partial patches over replacing complete field
maps. Follow [API.md](API.md), [agent preparation guidance](docs/AGENT-PREPARATION.md)
and [AGENTS.md](AGENTS.md). Owner-specific instructions belong in the private
workspace, not the source tree or public examples. The token grants substantial
access, including filing capabilities; the agent must stay within the owner's
actual authorization.

## Architecture

| Component | Purpose |
| --- | --- |
| `ui/`, `desktop/` | Desktop interface and PDF rendering |
| `server/` | Local REST API, SQLite storage and revisioned workflows |
| `native-engine/`, `native-common/` | Native .NET hosts and explicit extensions |
| `engines/` | Hash-pinned yearly calculation assemblies |
| `native-filing/` | Offline serializer host, schema checks and source corrections |
| `native-preview/`, `native-interview/` | Original resource-backed previews and interview |
| `native-barcode/` | Managed PDF417 rendering adapter |
| `tests/`, `scripts/` | Synthetic backend and renderer checks |

The offline serializer copy disables the original public-IP lookup. Its
`0.0.0.0` verification payload is never the live request: the live provider
finalizes the sender metadata, validates and hashes the final request before
transmission. NETFILE access codes remain visible in this private app so users
can verify them.

## Development and tests

```bash
npm test
npm install --no-save jsdom
JSDOM_PATH="$PWD/node_modules/jsdom" node scripts/test-ui-person-notes.mjs
```

Other renderer checks are in `scripts/test-ui*.mjs`. The 0.8.10 full backend run
passed 172 tests; later person-notes changes passed focused persistence, profile,
concurrency and renderer regressions. Test fixtures use synthetic identities.
These results do not establish universal tax parity or live CRA acceptance.

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Changes to
calculations, source mappings and filing serialization should include meaningful
synthetic comparisons, not just a matching headline balance.

## Privacy

Your local workspace contains sensitive personal data in a **plain SQLite
database**, along with private tokens, receipts, backups and export files. Protect
it with your operating system's access controls and disk encryption. The
repository excludes these files and build output. Do not commit your workspace,
real tax fixtures or screenshots of personal returns.

Calculations and offline previews run locally. Live filing and terms requests
contact CRA; public-IP detection can contact configured third-party services.
If you use an external AI provider, its handling of the information you give it
is separate from this local application. Do not expose the API directly to the
public Internet.

## License and credits

Our original application/adapters: [MIT](LICENSE). Bundled upstream components:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with GenuTax's supplied agreement
preserved under `third_party/genutax/`. This is a mixed-license distribution,
not an assertion that the bundled GenuTax code is open source.

Built with Electron, Node.js, SQLite and .NET. GenuTax is developed by GenuSource
Consulting Inc.; [REA](https://github.com/morluto/rea) was used to inspect the
original managed assemblies and establish source mappings and execution traces.
