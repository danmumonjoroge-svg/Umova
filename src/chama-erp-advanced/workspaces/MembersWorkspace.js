import React from "react";
import { useChama } from "../ChamaContext";
import MembersDirectory from "../MembersDirectory";

// The Members workspace IS the existing directory (search, filters, add,
// approve, suspend, edit role — all unchanged), now full-screen, with row
// taps opening a proper profile. Administrative buttons remain gated inside
// MembersDirectory by hasRole(); ordinary members never render them.
export default function MembersWorkspace({ go, params = {} }) {
  const { chama } = useChama();
  return (
    <MembersDirectory
      chamaId={chama?.id}
      initialStatus={params.status}
      onSelectMember={(m) => go(`members/profile/${m.id}`)}
    />
  );
}
