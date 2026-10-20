Shared pattern used by mpesa-save-config and mpesa-stk-push (inlined in each file so each function deploys on its own):

1. `callerClient` = createClient(SUPABASE_URL, **SUPABASE_ANON_KEY**, { Authorization: <caller's header> }).
   The original used the SERVICE ROLE key here with the caller's header. Do not do that: if a future edit ever drops the
   header, the client silently becomes service_role and every RLS check disappears.
2. `auth.getUser(token)` verifies the JWT with the Auth server. Only then are the `pos_tenant_id` / `pos_staff_id`
   claims read from the (now verified) token.
3. tenant_id is NEVER taken from the request body. It is read from the `lb_businesses` row the caller can see through RLS.
4. Permission is checked in the database with `pos_has_permission('<perm>')` as the caller (same function the triggers use).
