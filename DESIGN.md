# Desktop design

Tax Workbench is a working tray for several people and years. The return ledger is
the main view; a selected return becomes an input sheet and a calculation review.
There is no landing-page hero or decorative dashboard metric strip.

Palette: navy navigation #18374e, blue actions #215c88, pale canvas #eef2f6,
white working surfaces #ffffff, green reviewed states #27715e, amber unresolved
states #93661c. Color identifies navigation, action and state rather than decorating.

Cantarell follows the native Linux desktop. Numbers use tabular spacing, and labels
stay compact. Raw field codes use a monospace face only where exact identifiers are
useful. The layout gives the data table and editable form the most space; a narrow
summary column keeps the latest calculation visible without competing with inputs.

The screen distinguishes a locally reviewed snapshot from verified calculation
parity and from filing readiness. Review cannot silently certify a calculation.

The next pass treats each person/year as a case file: inputs, calculation,
original-form preview, filing and an immutable history. The filing receipt remains
visible after an amendment begins; local review and CRA acceptance have separate
labels. Refresh follows persisted changes, preserves focused inputs and scroll,
and surfaces concurrent edits rather than replacing an unsaved draft. Diagnostic
engine loading stays in the API, not in primary navigation.
