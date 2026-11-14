# Crypto disposals (2025)

Use the revisioned return-fields API to supply the original `CAPCR` inputs. Monetary values are CAD decimal strings. Do not enter a net loss as an expense against business income or invent proceeds/costs to produce a desired loss.

| Field | Meaning |
|---|---|
| `CAPGA:00001:R` | `Yes` when reporting capital gains/losses |
| `CAPCR:00001:R` | `Yes` when reporting crypto disposals |
| `CAPCR:00021:T:{asset}` | Asset description |
| `CAPCR:00022:F:{asset}` | Quantity disposed |
| `CAPCR:00024:D:{asset}` | Acquisition date, YYYY-MM-DD |
| `CAPCR:00025:C:{asset}` | Adjusted cost allocated to the disposed property |
| `CAPCR:00026:C:{asset}` | Acquisition costs not already in adjusted cost |
| `CAPCR:00027:C:{asset}` | Proceeds |
| `CAPCR:00028:C:{asset}` | Disposal costs not already netted from proceeds |

The original interview has no separate disposition-date input in this group. Preserve actual disposition dates, CAD valuations, quantity allocation, source records and accounting decisions in the preparation evidence. Identical-property pooling and superficial-loss rules require review across all relevant accounts, wallets and affiliated persons. Source-ledger specific-lot matching alone does not establish the correct Canadian tax adjusted cost.

The original 2025 calculation DLL computes each crypto gain/loss but omits `CAPCR` from its Schedule 3 activation guard. `native-common/CryptoSchedule.cs` starts the schedule with the exact original derived crypto proceeds and net-gain calculations; the original complete Schedule 3 calculation, loss inclusion, previews and serializer then run. Both the native calculation and offline filing wrappers apply the same correction. It is active only when both original capital-gains and crypto answers are `Yes`; it supplies no personal or housing answers.

Check the resulting original `SCH03:15301:C` full crypto gain/loss, Schedule 3, any crypto annex, line 12700 and loss carryforward. A current net capital loss generally does not reduce ordinary employment/business income. A source-backed capital loss can therefore leave the refund unchanged while still needing to appear on Schedule 3.

CRA source: [Capital losses](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/capital-losses-deductions.html), checked November13,2026:2025 inclusion50%, unusedlossgenerallyappliesonlytocapitalgains, andspouse/affiliated-personsuperficial-losschecks.
