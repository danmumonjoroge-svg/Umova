import React from "react";
import { useChama } from "../ChamaContext";
import { Megaphone, FileText, User, Repeat, LogOut, Wallet } from "lucide-react";
import { initials, roleLabel } from "../shell/format";
import { ActionCard, CardGrid, WorkspaceHeader, Pill } from "../shell/ui";
import LicenseBadge from "../shell/LicenseBadge";

// "More" holds the things you use now and then — never a dump of every
// database operation.
export default function MoreWorkspace({ go, onLogout }) {
  const { chama, member, memberships, backToChamaList } = useChama();
  return (
    <div>
      <WorkspaceHeader title="More" />
      <div className="cm-me">
        <span className="cm-avatar lg">{initials(member?.name)}</span>
        <div>
          <strong>{member?.name}</strong>
          <div className="cm-pills"><Pill tone="gold">{roleLabel(member?.role)}</Pill></div>
          <small>{chama?.name}{chama?.chama_no ? ` · ${chama.chama_no}` : ""}</small>
          <LicenseBadge chama={chama} />
        </div>
      </div>
      <CardGrid>
        <ActionCard icon={Megaphone} title="Updates" sub="Meetings and Chama notices" action="Open" onClick={() => go("more/updates")} />
        <ActionCard icon={FileText} title="My statement" sub="Everything paid in and out" action="Open" onClick={() => go("money/statement")} />
        <ActionCard icon={User} title="My profile" sub="Your details in the Chama" action="Open" onClick={() => go(`members/profile/${member?.id}`)} />
        <ActionCard icon={Wallet} title="Loans" sub="Apply, repay, rules" action="Open" onClick={() => go("loans")} />
        {memberships?.length > 1 && <ActionCard icon={Repeat} title="Switch Chama" sub="You belong to more than one" action="Switch" onClick={backToChamaList} />}
      </CardGrid>
      <button className="cm-btn danger block" onClick={onLogout}><LogOut size={15} /> Log out</button>
    </div>
  );
}
