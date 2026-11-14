# Pre-apportioned business-use-of-home expenses

Use `business.homeOfficeClaim` when a source schedule already supplies eligible
business-use expenses. This extension accepts that prepared amount explicitly;
it does not invent whole-home costs, office dimensions, or a floor-area ratio.
The existing `homeOffice` input remains available for actual whole-home costs and
the original area-ratio calculation. The two methods are mutually exclusive.

```json
{
  "homeOfficeClaim": {
    "currentExpenses": "1200.00",
    "priorUnusedExpenses": "0.00",
    "eligibilityConfirmed": false,
    "sourceReference": "Household expense schedule, business-use column",
    "basis": "Prepared eligible business-use amount; household arrangement under review"
  }
}
```

All five properties are required. Monetary values are nonnegative decimal strings
with at most two fractional digits. `priorUnusedExpenses` must be supplied
explicitly: do not silently assume zero when an earlier year may carry expenses.
Use `null` to remove this claim. A replacement object replaces the whole claim.

An unresolved claim can be calculated provisionally for reconciliation, but
`eligibilityConfirmed: false` must block review and filing. Confirmation means
the preparer checked the qualifying business use, eligible cost basis, reasonable
apportionment, household ownership/rental arrangement, and prior unused balance.
A ledger label such as rent or an owner's requested percentage does not by itself
resolve all of those facts.

The native adapter preserves the original cap and carryforward sequence:

1. Available expenses = current prepared expense + prior unused expense.
2. Income limit = maximum of zero and business income before home-office expense.
3. Allowed deduction = lesser of available expenses and income limit.
4. Unused expenses = maximum of zero and available expenses minus income limit.
5. Business net = original income before home office minus allowed deduction.

Thus the claim cannot create or increase a business loss. Unused amounts remain
visible and must be checked against the following year's opening balance.

The underlying unchanged 2021 arithmetic is recorded in REA-derived
`research/2021/calculation-instructions.cil.txt`, IL_02133f–IL_021441.
The extension supplies the prepared business-use amount at the computed expense
stage; downstream original tax formulas consume its capped deduction.

Internal controls are `WBHOM:00001:C:{business}` (current), `00002:C` (prior),
`00003:B` (eligibility confirmation), `00004:T` (source), and `00005:T` (basis).
They must be excluded from original tax-engine inputs and restored in API input
records. Previews must identify the extension and show the prepared amount,
income limit, deduction and unused expense; do not display invented whole-home
inputs to make the original home-expense worksheet appear populated.
