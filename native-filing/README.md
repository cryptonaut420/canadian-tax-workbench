# Native offline filing investigation

This host performs **no HTTP requests**. It generates the original engine's SOAP
from separate, explicitly changed offline serializer modules, validates with the
bundled CRA XSDs, and parses recorded/synthetic responses safely. It is not a live
filing client and never returns `liveReady: true`.

Workbench 0.8.1 adds automatic public IPv4 detection in the separate Node live layer, immediately before preparing a live submission. The native host below stays offline; do not restore its original network helper.

## Exact serialization with a bounded offline change

Original `BaseNetfileXML` invokes a private helper that calls
`https://icanhazip.com/` to obtain IPv4, then writes `comm:OriginatingIP`. The helper
returns `0.0.0.0` on failure. Automatic approval review blocked that third-party
lookup; no workaround sends the address elsewhere. The materially safer route
here replaces **only that helper** in separate module copies with `ldstr` of the
existing `0.0.0.0` literal followed by `ret`. No calculation instructions change.
The main `engines/` modules remain untouched.

`offline-engines/manifest.json` records source/result SHA-256, method token,
byte offset, old/replacement bytes and original REA evidence ID for every year.
`build_offline_engines.py` reproduces these local copies from the engine modules
and retained REA analysis (requires dnfile and those evidence files). The bundled
copies are already built; normal use requires no Python or REA installation.

2021 static evidence: `ev_387986b31fa6bfaf4e52c4df0675da832b952449269223052721e92e4355aa34`,
`GTCalculations.a()` token `0x0600003f`; caller `BaseNetfileXML` token
`0x06000046`, `IL_003dac`. The original helper has one external request and a catch
fallback. No HTTP client is used by this host or its Node adapter.

`NetfileXML(true, true)` selects the primary taxpayer and SOAP request format.
The first boolean false selects the spouse. The second boolean false produces the
`.ws` export wrapper, not the SOAP request. `RefileXML(true, true)` uses the same
SOAP service and marks the return amended; vendor metadata uses `113S` in the
bundled version, versus `113G` for NETFILE. These assigned vendor identifiers are
compatibility metadata; reproducing them is not independent CRA certification.

## Inputs and important gaps

`NativeFiling.prepare({year,mode,fields,spouseFields})` returns the locally generated
`payloadXml`, Latin-1 byte `payloadSha256`, `schemaValidated`, original eligibility
message/errors, terms request XML, transport metadata, and `offlineOnly: true`.
For ReFILE, `baselinePayloadXml` must come from the server's immutable accepted
submission record. It is schema-validated locally, placed in original fields
`REFIL:00001:T`/`REFIL:10001:I`, then original `RefileDifference(true)` computes
`REFCH` changes. The result returns `baselineSupplied` and `refileDifferences`. A
synthetic 2022 change correctly identifies employment +1,000 and the changed
refund. Acceptance itself must be established by the server receipt, not by this
XML or by an agent-provided field.

Input errors can produce no XML; schema-valid XML can still be ineligible to file.
These are distinct conditions. The results never declare complete-return parity.

The original desktop caller `GenuTax.l.a` (token `0x060000b9`) performs exactly
three calculation passes. The native host now follows those three passes and
initializes the original print list, then performs one independent verification
pass and compares primary/spouse fields and print-list order. A changed result
is rejected rather than silently running a different iteration algorithm. The
original PerformCalc boolean is not used as a convergence indicator. Calculation
instructions remain unchanged. This does not establish every original UI input
validation or every possible return case.

A synthetic source address for a Canadian resident uses:

| Meaning | Original field |
| --- | --- |
| Address country selector | `IDENT:00011:R` = `CANA` |
| Street | `IDENT:00014:T` |
| City | `IDENT:00016:T` |
| Province | `IDENT:00017:O` |
| Postal code, including space | `IDENT:00018:A` |
| SIN, original formatted storage | `TAXPY:00001:S` = `123 456 789` in tests only |
| Terms agreement | `FILIN:99902:R` = `Yes` |
| First-time filer | `FILIN:99903:R` = `Yes` |

Derived `IDENT:001xx` values are overwritten; supplying them as inputs does not
populate the underlying address. Terms agreement is a human action, never a
profile default. Synthetic fixtures deliberately leave it unaccepted.

2023–2025 changed residency input: a full-year ordinary Canadian resident uses
`RESID:00301:R` = `1`; the older `RESID:00001:R` = `Yes` is insufficient and yields
an invalid blank ResidencyType. Other residency scenarios require their own
verified mappings, not a guessed conversion. This is an observed mapping change,
not tax advice or a classification of a real taxpayer.

ReFILE availability is not inferred from an accepted NETFILE record. The original
2019–2021 modules explicitly report ReFILE unavailable. Original eligibility also
flags expired CPP/EI overpayment claims for older years. Current CRA availability
and processing/assessment requirements need separate verification.

## SOAP and response handling

Both modes use `POST` to the CRA `FileReturnService`, content type
`text/xml;charset=iso-8859-1`, empty SOAPAction, no automatic retries. NETFILE terms
request is `t1rq:TermsAndConditionsRequest`; ReFILE uses
`t1rq:RefileTermsAndConditionsRequest`. Response schema is the same.

`parseResponse(xml,{year})` accepts only an exact SOAP 1.1 envelope with one body
and one response payload in the CRA response namespace. It validates against that
year's embedded response schema. DTDs/external entities, network schema resolution,
oversized XML, unexpected namespaces and malformed envelopes are rejected.

| Response branch | Local outcome |
| --- | --- |
| FileReturnResponse / Confirmation with valid nonempty ConfirmationCode | `accepted` |
| Rejection | `rejected` |
| ProcessingError (with error codes/messages) | `rejected` |
| SystemError, SOAP Fault, malformed or unrecognized response | `unknown` |
| Confirmation without a code | `unknown` |
| TermsAndConditionsResponse / TermsAndConditions | `terms` |

Unknown outcomes require reconciliation, never an automatic retry. Response
schemas have **no CRA submission timestamp**: `receivedAt` is local receipt time,
with `dateSource` naming that fact. Store attempt time, receipt time, the exact
confirmation code and immutable request/response hashes separately.

`verification.json` contains synthetic offline NETFILE/ReFILE checks for all seven
years; it contains no real taxpayer payload or credentials. Tests cover original
terms requests, generated 2021 SOAP/XSD, accepted/rejected/errors/terms, empty
confirmation, wrong namespace, SOAP fault, malformed XML and external entities.

## Remaining parity work

Full input-model completeness, original .gt1 import/accepted-return baselines,
spousal calculations, all relevant schedules, live terms/acknowledgement behavior
and certification/current service eligibility are not established by these tests.
Offline schema validation is a significant integration check, not evidence that a
real return is complete or safe to transmit.

## Live provider boundary

`server/live-filing.mjs` wraps this offline native host with an explicitly
authorized live workflow. Constructing or initializing it opens no connection.
The root API owns the default-off live setting and snapshot-bound confirmation.
The provider retrieves only the original terms request directly from the fixed
CRA endpoint, validates the response against the bundled yearly schema, and
issues an expiring server-cached terms ID/hash. Client-supplied terms are not
trusted. Terms must match the tax year and NETFILE/ReFILE mode.

Live preparation is still local. A pending-confirmation copy normalizes standard
SIN formatting, validates its checksum, and sets the original agreement source
field. The original serializer generates AgreementIndicator1. A pure native XML
step replaces exactly one original OriginatingIP placeholder with the public IPv4
provided in Settings, then validates the complete XML again. No third-party IP
lookup is performed, and stored answers are never silently changed. Temporary or
individual tax-number filing is not yet independently verified.

`assertCanSend` checks the server-cached prepared-payload hash, current terms and
metadata before a durable attempt begins. `send` revalidates XML, identity, year,
IP and agreement; rechecks terms after async work; and calls the root's synchronous
`allowSend()` immediately before opening HTTPS. Local preflight errors carry
`notSent=true` so the root records a local cancellation instead of falsely
claiming a network ambiguity. Turning the setting off never sends a return.

The HTTPS boundary makes one request, has a hard total60-second deadline including
DNS/handshake/read, refuses redirects/retries, limits response size, respects
HTTP/XML charset declarations and hashes the exact response bytes. The generic
original Microsoft web-services User-Agent is preserved. Terms and filing both
use the same fixed CRA service, with no GenuTax-hosted intermediary.

The live-provider tests intercept HTTPS with synthetic terms and receipts. They
cover public-IP checks, standard SIN checksum/format, source immutability, explicit
metadata replacement, terms expiry/forgery/mode binding, payload integrity and a
setting-off race during validation. No real CRA terms or taxpayer submission was
sent in these tests. Live service acceptance and exhaustive application parity
remain unverified; an enabled toggle does not assert CRA certification.

NETFILE access-code mapping is `FILIN:99931:M`. Offline probes against all seven
modules confirm it is emitted for2020–2025 when `FILIN:99903:R` is notYes. The
2019 serializer never emits it; first-time filerYes suppresses it in all years.
An explicit first-timeNo produces FirstTimeFilerIndicator2, whileYes produces1.
Live preparation therefore requires an explicitYes/No answer; choosing NETFILE
for a new tax year must not silently answer the first-ever-filer question. The
optional access code, when used, is eight alphanumeric characters.

## Live response compatibility (0.8.3)

The current service returns a two-digit numeric ResultCode; historical bundled response schemas require six characters. NetfileReturnResponse validation uses the latest bundled response contract for all filing years and validates an isolated clone with zero padding for exactly two-digit codes. The raw code, XML, response bytes and hash remain unchanged. Acceptance still requires a schema-valid Confirmation and nonempty ConfirmationCode; malformed or incomplete responses remain unknown. Request schemas and calculation modules are unchanged.

`server/receipt-reconciliation.mjs` can reparse an existing saved HTTP-200 receipt offline after verifying its original bytes/hash. It preserves send/receipt timestamps, retains the prior response in an audit table and restores the accepted request as the ReFILE baseline. It never sends or retries a return.

### Legacy direct responses (0.8.4)

The 2019 request can receive a direct FileReturnResponse SOAP payload rather than the newer NetfileReturnResponse wrapper. That direct payload is validated with the original 2019 response schema, with the same strict namespace/envelope checks. Both confirmations and processing rejections are classified from the validated body. Saved unknown receipts can be reclassified as accepted or rejected with original evidence/timestamps retained; reconciliation never sends a return.

## T5013 source-presence correction (0.8.8)

`PartnershipGross.cs` applies an explicit correction after the original serializer,
without modifying yearly calculation IL. Original T5013 EDI generation substitutes
$1 for a missing gross-income box118. When an actual issued slip omits118, the
host removes that statement's8299 line; it does not enter a zero or invent gross
income from archived books. A supplied zero is preserved as zero. Nonzero supplied
amounts and other financial statements stay on the original path.

Matching uses the unique nine-digit partnership BN and fiscal period end from the
original slip inputs. Ambiguous matches fail closed. XML is normalized with the
original encoding, revalidated against the original year's embedded schema and
hashed after correction. `partnershipGrossAdjustments` records the correction for
offline review. Missing source amounts remain missing in the API/source report;
ordinary native calculation aggregate defaults are not confirmed slip amounts.


## Restored required gross source (0.8.9)

Active-business T5013 box118 is required again. The native adapter rejects a
missing gross source instead of emitting the old $1 placeholder or omitting8299.
The only retained gross correction preserves a genuine explicit zero. The0.8.8
missing-box behavior above describes the prior version, not current acceptance.
Existing incomplete saved inputs are not modified by this update.

### T5013 COVID statement reconciliation (0.8.10)

PartnershipGross.cs also reconciles explicit COVID assistance in box114 with
statement9946. The original calculation routes01104:C to business income, but
the serializer omitted it. Match the actual BN/fiscal period, verify the original
net source sum and its whole-dollar truncation, then serialize the corrected
source sum plus COVID amount. Keep gross118 untouched except the established
explicit-zero correction. Unexpected matches fail closed. The existing
partnershipGrossAdjustments audit array records both kinds of source corrections.
No calculation IL or source-slip amount is changed.
