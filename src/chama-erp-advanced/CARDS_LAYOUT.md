# Cards & sub-cards layout pass

Pages are now a short stack of **Panels** (cards, gold/green top edge, tap header to fold) holding **SubCards** (one item each) and **Stat** tiles — instead of one long scroll.

New primitives in `shell/ui.js`: `Panel`, `SubCard`, `SubCardList`, `StatGrid`/`Stat`, `TabBar`. Styles are appended to `workspaces/workspaces.css`.

Converted: Home, My statement, Member profile, My loans, Loan rules, My welfare, Updates, Group report (members/loans → one SubCard each, no wide tables), Check contributions (table → cards with Check/Approve buttons), Loan approvals/payouts/repayments, Chama accounts, Move money, Projects, Welfare insights, Members, Loan application, Contribute, Record for a member, Chama finances.

No business logic, Supabase calls, roles or SQL were changed — only markup/CSS. Not changed: WelfareCaseDesk, WelfareEventPlanner (large; keep their own layout), auth screens, platform admin.
Checked: syntax of all 59 files; card styling rendered at 390px with no horizontal overflow. Not run against real Supabase.

## Update: compact tiles
Cards are now small tiles in a grid (2 per row on phones, 3 tablet, 4 desktop) instead of full-width stripes; lists and stats inside tiles stack as short label/value lines.
