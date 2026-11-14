# Original yearly interview definitions

`2019.json.gz` through `2025.json.gz` preserve original GenuTax interview topics,
field controls, option tags, text, branches, actions and custom validation trees.
`manifest.json` pins each output and source resource assembly and its REA Evidence
identifier. The extractor reads managed resources without executing target code;
normal use needs no REA, Wine, GenuTax installation, or network request.

`server/interview.mjs` exposes:

- `interviewCatalog(year, fields, options)` — section/progress metadata and paged
  topics. Options include section, search, answered, offset, limit, topicId,
  instances and computedFields. The default page size is20 and maximum100.
- `interviewDefinition(year, topicId)` — exact retained topic definition.
- `interviewPatch(year, fields, answers, options)` — validates source field edits
  and returns merged fields, changes and warnings. Values are strings or null to
  clear. Repeated fields require explicit positive instance identifiers.
- `suggestDefaults(year, fields, options)` — conservative optional No/zero
  proposals, never applied automatically.
- `applyInterviewDefaults(year, fields, {codes, confirmed:true, ...options})` —
  applies only selected current proposals after explicit confirmation.

Source and computed fields are resolved by physical field identity even when
GenuTax's flattened string values use T rather than the original R/O type tag.
Unknown branch values stop routing instead of defaulting false. Financial decimal
comparisons use BigInt-scaled decimal strings. Complex or unported controls carry
readonly reasons instead of making guessed writes. SIN input is normalized to the
original spaced storage form, and Canadian postal codes to uppercase spaced form.
Full specialized identity validation is not established by that formatting.

For paired returns, the calling workspace chooses whether it is passing primary
or spouse source fields. The original numeric Taxpayer branch guard is interpreted for explicit primary
and spouse scopes; unknown selectors remain unresolved. All edits must still use the workspace's optimistic revision and
snapshot invalidation rules; this module does not write SQLite directly.

See `research/features.md` for feature coverage and remaining parity gaps.

## Original validation and paired-scope audit

`interviewValidation(year, fields, options)` reads original boolean validation flags
from `options.computedFields`, never from untrusted answer values. It returns
checks, blocking errors, unknown checks and counts. Flags are scoped to the current
person and explicit/enumerated loop instances. Missing computed flags remain
unknown rather than becoming a passing false. Section routing supplies known
active/inactive context where it can be resolved; ambiguous routes remain unknown.
This is a nonmutating report and must be recalculated after source answers change.

The original 2019–2025 resources contain respectively 180,188,211,227,225,253,259
custom Validation definitions, all referencing B-type native calculated flags.
REA inspection of `GenuTax.aa.d` (0x0600024b) shows loop indices appended to those
FieldIDs before creating validation descriptors. `GenuTax.aa.a` (0x06000262)
selects the descriptor's primary/spouse data table, calls the boolean getter and
blocks advancement when true. This behavior is implemented for available current
calculated snapshots; it is not a claim that all original routing is recovered.

`options.taxpayer` defaults to primary. Spouse editing requires an explicit spouse
source map supplied by the caller; topics not marked Spousal are read-only in
that scope. Topic.Spousal=true means the original can present the question for a
paired spouse; it does not automatically redirect primary answers into the spouse
map. Original branch Taxpayer selectors are now interpreted as a current-person guard:
1 matches the primary taxpayer and 2 the spouse. They do not read or write another
person’s map. Unknown selector values remain unresolved/read-only.

The universal original GTPercentageEditor validates values no greater than 100
(0x06000171). That intrinsic maximum is enforced even when individual XML fields
have no explicit MaxValue. Original SIN editing uses mask `### ### ###` and the
pure Luhn helper `GenuTax.u.a(string)` (0x060001f4); the same checksum is enforced
here without guessing additional prefix rules. See the retained REA JSON/CIL in
research/interviews for method- and artifact-bound evidence.


Additional source-backed recovery: the branch descriptor evaluator
`GenuTax.aa/e.a` (0x0600026d) compares the controller's current-person index to
`Taxpayer-1`. Taxpayer=1 therefore applies a branch only to the primary person,
Taxpayer=2 only to the spouse, and an absent/zero selector uses the current person.
The original Confirmation nodes are separately reported: a true flag means a user
acknowledgement is required; no acknowledgement is inferred or applied. Original
record/orphan actions remain deferred metadata and never run automatically.

## Native orphan cleanup checkpoints

`interviewPatch` now returns `requiresOrphanCleanup` and `cleanupCommands` when an
actually changed primary-scope answer belongs to an original topic with
`ClearOrphans="true"`.
This is a request for the workspace to run the original native cleanup and retain
before/after revisions; the pure patch function does not delete records itself.
Unchanged answers and topics without that exact original attribute do not invent
cleanup commands. For example, the original self-employment gate has no such
checkpoint attribute even though a later global cleanup can remove records made
orphaned by answering it No. Live preparation must also detect inconsistent
explicit-No gates with surviving financial records and require review/cleanup.

Verified positive-entry gates, unchanged across2019–2025: investment income
`INVIN:00001:R=Yes` (for T5 investment income), RPP contributions
`RPPLA:00001:R=Yes` (positive reported RPP contributions), and employment union
dues `UNION:00001:R=Yes`. A fast editor may set these Yes only when the entered
source slip establishes that fact; it must not invent No for unknown questions.


Exact cleanup timing proof: `GenuTax.aa.d` (0x0600024b) reads ClearOrphans at
IL_001c71, checks current-person index zero at IL_001cbd, then calls MainForm.k
(0x060002dc) at IL_001cfe while rendering that checkpoint. The patch result records
this `originalWhen` separately from the workspace's intentionally earlier/later
`requestedWhen` boundary after a saved answer. This avoids claiming that the
original native cleanup was itself attached to every No answer or Next click.
