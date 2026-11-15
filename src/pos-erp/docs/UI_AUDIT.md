# UI audit and final upgrade

## Findings (all 50+ screens checked)
| Group | State before | Action |
|---|---|---|
| Home, More, Printable Reports, Budget, workspaces (Retail, Money, People, Rooms...) | On the gold/green kit | Home, More and Reports redesigned this round |
| About 20 older pages: M-Pesa, Cash, My Spending, Financial Statements, Close the day, Sale corrections, Invoices, Rent & Charges, Meters, Maintenance, Units, Services, Appointments, Staff, Staff records, Payroll, Customer Messages, Notifications, Audit, Control report | Grey / slate / blue / bright red-green utility colours, no shared page shell | Re-coloured to gold/green by `theme/posSkin.css` (no logic touched) |
| Loading and empty states | Plain "Loading..." text and a bare dashed box | Shimmer skeleton cards; empty state with an icon |
| Page changes | Instant jump | Short fade-up on every page |
| Inputs and focus | Mixed focus colours | One gold focus ring, steady-width numbers in tables, tap feedback off the grey flash |
| Cashier till (POSPage, 1,159 lines) | Mostly custom green; 23 old colour classes | Covered by the skin; not restructured (highest-risk screen, needs a phone test first) |

## Still worth doing later (needs a design pass per page, not a recolour)
1. Move the ~20 older pages onto `FitPage` / `DataCard` so they also get the card grid, search and summary tiles.
2. M-Pesa page: the old setup form and day list are long; fold setup into a sheet.
3. Till: larger quantity steppers and a sticky total bar on small phones.
4. Add a "pull to refresh" gesture on Home and lists.

## Files in this upgrade
`theme/posSkin.css` (new), `POSLayout.jsx`, `components/CardKit.jsx`.
