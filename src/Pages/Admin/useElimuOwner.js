import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

// True only for sign-ins on the Elimu owners list (checked by the database, not by the Finance role).
export default function useElimuOwner(isApprover) {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    if (!isApprover) { setOwner(false); return; }
    let alive = true;
    (async () => {
      try { const { data, error } = await supabase.rpc("elimu_is_platform_owner"); if (alive) setOwner(!error && data === true); }
      catch (e) { if (alive) setOwner(false); }
    })();
    return () => { alive = false; };
  }, [isApprover]);
  return owner;
}
