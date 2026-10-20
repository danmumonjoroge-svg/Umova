# Phone test script (about 20 minutes). Use a TEST business, not a real shop.
Write PASS / FAIL and what you saw. Send me every FAIL.

## A. Receipt and Back (online)
1. Sell 1 item, cash. Receipt screen opens.  [ ]
2. Tap Print, then cancel the print sheet. You are still on the receipt; Done works.  [ ]
3. Tap Print again and finish (or Save as PDF). Back on the receipt. Sales list shows ONE new sale, not two.  [ ]
4. Tap Print twice fast. Only one print sheet opens.  [ ]
5. Press Android Back with the receipt open. Receipt closes, you stay on Sell.  [ ]
6. Sell again, tap "Done - back to sale". You are on Sell; press Back once: you do NOT land on a stale receipt.  [ ]
7. If the print sheet never opens: do you see "Printing did not start..."? Can you still press Done?  [ ]

## B. M-Pesa "Already paid" (no setup needed) - business with NO M-Pesa setup
8. Pick M-Pesa. "Send prompt" shows "Not set up yet" and is greyed; "Already paid" is selected.  [ ]
9. Complete button stays disabled until you type a valid code (e.g. SHK7X9ABCD). Lowercase is fixed to capitals.  [ ]
10. Complete. Receipt shows "Paid (M-Pesa SHK7X9ABCD)".  [ ]
11. Sell again with the SAME code. You get "already used".  [ ]
12. Split payment: Cash + M-Pesa (code). Totals must match exactly; sale completes.  [ ]
13. My Money > M-Pesa page: today's code appears under "Recorded at the till" and the totals include it.  [ ]
14. Close the day (Reconciliation): M-Pesa total equals the codes you entered.  [ ]

## C. M-Pesa offline
15. Turn off Wi-Fi and mobile data. Sell with M-Pesa + a NEW code. It saves ("Saved on this phone").  [ ]
16. Sell offline with the same code again. Blocked as already used.  [ ]
17. Close and reopen the app, still offline. The sale is still in the "Saved on this phone" list.  [ ]
18. Turn internet on. The sale is sent once. Check it appears once in sales with the code. No duplicate.  [ ]

## D. Offline sale IDs (two phones, if you have two)
19. Put both phones offline. Make one sale on each. Reconnect both. Two separate sales exist on the server.  [ ]

## E. Prompt (only after you set up Daraja)
20. Not tested here: needs your Daraja credentials and the phase34 SQL on staging.  [ ]
