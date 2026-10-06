# Chama ERP — Guided Demo Walkthrough

**Demo chama:** Mwangaza Self-Help Group (DEMO) · **Plan:** Free (no expiry, no billing countdown)
**Password for every demo login:** `Demo1234`
**Length:** 15–20 minutes · **Best on:** a phone, or a browser window narrowed to phone width

## Before each demo (2 minutes)

1. In the Supabase SQL editor, run `sql/007b_demo_prerequisites.sql` once (adds the loan, announcement and welfare tables/columns the demo needs; safe to re-run), then run `sql/008_demo_chama.sql`. It wipes and rebuilds the demo chama with dates relative to today, so the data always looks current and your last demo never leaks into the next.
2. Check the last query in the output: `plan = free`, `members = 12`, `members_with_login = 12`.
3. Open the app in two sessions: one normal window, one private window. You'll switch between the Treasurer and a Member to show both sides.

## How prospects get in

On the login screen, under the normal form, there is a **"Get the demo"** box with five role cards (Treasurer, Chairperson, Secretary, Welfare officer, Member). One tap logs straight in, with no phone number or password to type. A **Demo** badge shows in the header while inside. To switch role, log out and tap another card.

## Who is who

| Login | Name | Role | Use in the demo |
|---|---|---|---|
| 0711000003 | Mary Atieno | Treasurer | Reconciles money, disburses loans |
| 0711000001 | Grace Wanjiku | Chairperson | Gives the final loan approval |
| 0711000002 | Peter Kamau | Secretary | Approves members, posts updates |
| 0711000004 | John Mwangi | Welfare officer | Runs welfare cases |
| 0711000005 | Esther Njeri | Member | Member view: statement, active loan |
| 0711000009 | Lucy Wambui | Member | Applies for a loan live |
| 0711000012 | Daniel Ochieng | Pending applicant | Gets approved live |

---

## Act 1 — The member's view (3 min)
*Message for the prospect: every member sees only their own money, in one place, on their phone.*

**Tap *Member* under "Get the demo" (Esther Njeri).**

1. **Home.** Her savings, shares and welfare balances, her active loan, and the pinned meeting notice at the top.
2. **My statement.** Six months of contributions, her loan disbursement and repayments. Point out that balances and statement come from the same ledger, so they always agree.
3. **My loans.** One active loan: KES 40,000, with a balance of KES 10,000 remaining.
4. **Money → Contribute.** Show the form: pick the chama account, amount, M-Pesa reference. Do not submit yet.

> **Talking point:** No more WhatsApp screenshots of M-Pesa messages and no "did my money reach?" calls to the treasurer.

## Act 2 — The treasurer verifies, nothing posts without checks (4 min)
*Message: money only reaches a member's balance after it is verified against the real account statement.*

**Log out, then tap *Treasurer* (Mary Atieno).**

1. **Money → Reconciliation.** The queue has live work:
   - **3 Pending** (Ruth, Joseph, Lucy) — just submitted, not yet checked.
   - **2 Verified** (Samuel's savings, Esther's final loan instalment) — checked, ready to post.
   - **1 Rejected** (David, reference not found on the statement).
2. Open one *Pending* item. Enter the bank statement amount, then verify it. Show that a mismatch is flagged instead of posted.
3. **Post Samuel's verified savings.** His balance rises, and a ledger entry is created.
4. **Post Esther's verified loan repayment.** Her loan balance goes from 10,000 to 0 and the loan flips to **closed**.

> **Talking point:** Verify and post are separate steps by design. That is the control that stops mistakes and fraud in a money-handling group.

## Act 3 — Loans with multi-signature approval (5 min)
*Message: loans follow your constitution. The rules are enforced by the system, not by memory.*

1. **Loans → Loan rules** (as Chairperson, Grace). Show the rules: 3× savings limit, 2 guarantors, 5% flat monthly, three-role approval (Secretary → Treasurer → Chairperson), one active loan per member.
2. **Log in as Lucy Wambui (0711000009) → apply for a loan.** Try KES 80,000 first. The system blocks it (over 3× her savings of KES 18,000). Then apply for a valid amount, e.g. KES 20,000, with two guarantors.
3. **Approval queue** (Grace, Peter, Mary):
   - **David Kiprono's KES 30,000** loan already has the Secretary and Treasurer signatures. Log in as **Grace (Chairperson)** and give the final approval. A loan record is created automatically.
   - Show **Lucy's** application with zero approvals so far.
4. **Faith Chebet's KES 60,000** loan is fully approved and waiting. As **Mary (Treasurer)**, disburse it from the Equity account. The ledger records the payout.
5. Show **Joseph Mutua's rejected** application and its reason, so prospects see that rejections are recorded and explained.

> **Talking point:** A loan cannot be approved by one person alone, and every decision is time-stamped with the approver's name.

## Act 4 — Welfare, handled with dignity (4 min)
*Message: funerals and emergencies are the heart of a chama. Visibility settings are respected.*

**Log in as John Mwangi (Welfare Officer, 0711000004) → Welfare.**

1. **Burial support — Ruth Akinyi's mother** (open, target KES 60,000). Show the progress against target, contributions from members, an **anonymous** gift, an **external organization** (Kiambu Teachers SACCO, by cheque), and a member **pledge** not yet received.
2. Approve one of the **two pending** contributions (Lucy's or Joseph's).
3. Open the case settings: amounts, contributor names and ranking can each be shown or hidden. Mention that a beneficiary can be kept from seeing the case.
4. **Hospital bills — Samuel Otieno** (about half raised) and the **closed wedding case** (history).
5. **Events:** the burial planning meeting and the hospital visit, each with assigned tasks (tent, transport, programme). Mark one task done.

## Act 5 — Run the group (2 min)

1. **Members** (as Peter, Secretary). Daniel Ochieng is **pending**. Approve him live; he can then log in with the same phone number.
2. **More → Updates.** Post an announcement (a meeting, a reminder, a notice) and pin it. Show it appearing on every member's Home.
3. **Licensing note** (briefly): this demo runs on the **Free** plan. Real chamas get a 30-day trial, then simple per-chama billing handled by the platform admin.

---

## Closing questions to ask the prospect
- How does your group record contributions today, and how long does reconciliation take each month?
- Who approves loans, and how do you keep a record of who signed off?
- How many members, and do they all have smartphones?

## Troubleshooting
- **"Account already exists"** at login or registration: the demo logins are re-created on every run of `008`. Run the script again.
- **A screen looks empty:** run the script again; the data is generated relative to today, so very old copies of the database can look stale.
- **Loan application blocked:** that is the loan rules working. Check amount ≤ 3× savings and that the member has no other active loan.
- **Want to show billing/lock-out?** The demo is on the Free plan, so it never expires. Use a separate non-demo chama for that.
