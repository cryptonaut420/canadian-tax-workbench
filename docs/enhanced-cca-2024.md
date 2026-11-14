# Enhanced 2024 class50 capital allowance

This explicit Workbench extension updates the 2024 original engine for qualifying class50 productivity-enhancing acquisitions. It is not an arbitrary CCA or business-net-income override. The 2025 original engine already implements the enhanced calculation; do not enable this adapter for 2025.

Original asset costs, personal portions, opening UCC and acquisition records remain unchanged. The adapter adds the regulation's 9/11 adjustment to the original class calculation base. The original engine then applies55%, its selected claim limit, business-income calculations and closing-UCC arithmetic. For a qualifying $1,000 addition, `(1000 + 1000 × 9/11) × 55% = 1000`.

Official source: Income Tax Regulations subsection1100(2), descriptionA paragraph(c.3)(i), [Justice Canada](https://laws-lois.justice.gc.ca/eng/regulations/C.R.C.%2C_c._945/section-1100.html). CRA's [class50 guidance](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships/report-business-income-expenses/claiming-capital-cost-allowance/classes-depreciable-property.html) describes the enhanced first-year deduction and previous-use restrictions.

## Structured business input

Supply original `ccaClasses[].additions` first. The business eligibility extension uses:

```json
{
  "enhancedCca2024": [{
    "classId": "1",
    "assetId": "1",
    "eligibilityConfirmed": false,
    "acquiredDate": "2024-05-01",
    "availableForUseDate": "2024-05-01",
    "sourceReference": "Invoice and capital asset register references",
    "eligibilityBasis": "Explain qualifying AIIP, ownership, previous use and arm-length restrictions; identify any unverified dates."
  }]
}
```

Each record refers to an actual original class50 asset. The original asset must have `acceleratedInvestment: "Yes"`, `acquiredYear: "AFT23"`, and must not claim designated immediate expensing. Use the tax cost after personal-use allocation and recoverable GST treatment, supported by records.

The adapter currently accepts only full-calendar-year 2024 businesses with no dispositions in the selected class. Acquisition and available-for-use dates must both fall afterApril15,2024 and within2024; available-for-use cannot precede acquisition. Other scenarios require an explicit reviewed implementation rather than inferred eligibility.

`eligibilityConfirmed: false` permits a **provisional calculation** and creates a filing blocker. Confirmation must reflect reviewed source evidence. A purchase date alone does not establish available-for-use or previous-use eligibility. Private-seller or used assets need the applicable restriction review. Supply `null` or `[]` to remove the business's enhanced eligibility records.

## Raw metadata and integration

`WBCCA:00001:B:{business}:{class}:{asset}` stores the explicit confirmation;00002:D acquisition date;00003:D available-for-use date;00004:T source;00005:T basis. These metadata fields must be excluded from original engine data and handled exclusively by `EnhancedCca2024`.

Run `validateEnhancedCca2024` for raw-field writes, and include `enhancedCca2024Issues` in preparation and submission readiness. Install `EnhancedCca2024` on each taxpayer before original calculations. Preserve its audit report in calculation and preview results. The native adapter performs the same validation independently, including for direct runner calls.
