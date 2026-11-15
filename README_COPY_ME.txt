Unzip this file INTO C:\Users\DMUMO\ so that the folder "sacco-dashboard" merges with yours (choose "Replace" if asked).
It places:
  sacco-dashboard\src\pos-erp\...              (app code + schema\phase39/40/41 SQL files)
  sacco-dashboard\supabase\functions\mpesa-*   (3 M-Pesa functions)
Then, in PowerShell:
  cd C:\Users\DMUMO\sacco-dashboard
  supabase login
  supabase link --project-ref tejzcwftbvcojvpczxbm
  supabase functions deploy mpesa-save-config --no-verify-jwt
  supabase functions deploy mpesa-stk-push --no-verify-jwt
Then run in the Supabase SQL editor, in order:
  src\pos-erp\schema\phase39_mpesa_manual_and_prompt.sql
  src\pos-erp\schema\phase40_loan_expense_actor_fix.sql
  src\pos-erp\schema\phase41_loan_reducing_balance.sql
