"use client";

import Link from "next/link";
import { useSnap } from "@/lib/data";
import { emptyFilters, fellowTotals } from "@/lib/rules";
import { useActions } from "@/components/actions";
import { Avatar, Button, LinkButton, PageTitle, cx } from "@/components/ui";

export default function FellowsPage() {
  const { snap, now } = useSnap();
  const actions = useActions();
  const totals = fellowTotals(snap, emptyFilters, now);
  return (
    <div>
      <PageTitle title="Fellows" subtitle={`${snap.fellows.length} on the roster · ${snap.settings.class_label}`}
        actions={<>
          <Button variant="gold" onClick={() => actions.planAway()}>Plan time away</Button>
          <LinkButton href="/reports">Reports & export</LinkButton>
        </>} />
      <p className="mb-4 max-w-prose text-[14px] text-muted">
        <strong className="text-navy">Events missed</strong> counts confirmed absences at completed, required, non-canceled events.
        <strong className="text-navy"> Planned ahead</strong> is shown separately and never added to it. These are attendance records, not rankings.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {totals.map((t) => (
          <li key={t.fellow.id} className="min-w-0">
            <Link href={`/fellow?id=${t.fellow.id}`} className="flex h-full min-w-0 flex-col rounded-2xl bg-card p-4 ring-1 ring-line hover:ring-gold">
              <div className="flex items-center gap-3">
                <Avatar fellow={t.fellow} size={60} />
                <div className="min-w-0">
                  <p className="font-serif text-[19px] font-semibold leading-tight">{t.fellow.display_name}</p>
                  <p className="truncate text-[14px] text-muted">{t.fellow.agency || (t.fellow.is_placeholder ? "Placeholder — name not yet entered" : "Placement not set")}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-1.5 text-center sm:gap-2">
                <Metric label="Events missed" n={t.eventsMissed} strong />
                <Metric label="Speaker Series missed" n={t.speakerSeriesMissed} />
                <Metric label="Planned ahead" n={t.plannedUpcoming} tone="text-gold-ink" />
              </dl>
              {t.notRecorded > 0 && <p className="mt-2 text-center text-[13px] text-muted">{t.notRecorded} past event{t.notRecorded === 1 ? "" : "s"} not yet recorded</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ label, n, strong, tone }: { label: string; n: number; strong?: boolean; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-paper px-1 py-2 ring-1 ring-line">
      <dd className={cx("font-serif text-[24px] font-semibold tabular", tone, strong && "text-navy")}>{n}</dd>
      <dt className="break-words text-[12px] leading-tight text-muted [hyphens:auto]">{label}</dt>
    </div>
  );
}
