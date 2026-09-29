import React from "react";
import { HeartHandshake, Heart, CalendarDays, Folder, BarChart3 } from "lucide-react";
import { formatKES } from "../shell/format";
import { useCapabilities, useMine, useWork } from "../shell/work";
import { ActionCard, CardGrid, SectionTitle, WorkspaceHeader, StaleNote } from "../shell/ui";

export default function WelfareWorkspace({ go }) {
  const can = useCapabilities();
  const mine = useMine();
  const { work } = useWork();
  const me = mine.data?.me;

  return (
    <div>
      <WorkspaceHeader title="Welfare" subtitle="Standing together in good times and hard times" />
      <StaleNote fromCache={mine.fromCache} cachedAt={mine.cachedAt} online={mine.online} />
      <CardGrid>
        <ActionCard icon={HeartHandshake} title="My welfare" value={me ? formatKES(me.welfare_balance) : "…"} sub="what you have given" action="View" onClick={() => go("welfare/mine")} />
        <ActionCard icon={Heart} title="Give to welfare" sub="Tell us what you sent" action="Contribute" onClick={() => go("welfare/contribute")} />
        <ActionCard icon={CalendarDays} title="Welfare events" sub="What is coming up" action="See events" onClick={() => go("welfare/mine")} />
      </CardGrid>

      {can.welfare && (
        <>
          <SectionTitle>For welfare officials</SectionTitle>
          <CardGrid>
            <ActionCard icon={Folder} title="Welfare cases" value={work.openCases ?? "…"} sub="open" action="Open" onClick={() => go("welfare/cases")} />
            <ActionCard icon={CalendarDays} title="Plan events" sub="Fundraisers, visits, ceremonies" action="Open" onClick={() => go("welfare/events")} />
            <ActionCard icon={BarChart3} title="Welfare insights" sub="Funds and trends" action="View" onClick={() => go("welfare/insights")} />
          </CardGrid>
        </>
      )}
    </div>
  );
}
