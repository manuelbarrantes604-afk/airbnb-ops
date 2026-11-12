"use client";

import { useMemo, useState } from "react";
import { useLookups, useSnap } from "@/lib/data";
import { EVENT_TYPE_LABELS, type EventType } from "@/lib/types";
import { classTotals, emptyFilters, fellowTotals, isCountedAbsence, reportRows, sortFellows, type ReportFilters } from "@/lib/rules";
import { fmtDateShort, fmtTime, todayKey } from "@/lib/time";
import { downloadCsv, toCsv } from "@/lib/csv";
import { Button, Card, Empty, PageTitle, SectionTitle, inputCls } from "@/components/ui";

const STATUS_LABEL = { present: "Present", absent: "Absent", not_recorded: "Not recorded" } as const;

export default function ReportsPage() {
  const { snap, now } = useSnap();
  const L = useLookups();
  const [f, setF] = useState<ReportFilters>(emptyFilters);
  const set = (patch: Partial<ReportFilters>) => setF((x) => ({ ...x, ...patch }));

  const totals = useMemo(() => fellowTotals(snap, f, now), [snap, f, now]);
  const cls = useMemo(() => classTotals(snap, f, now), [snap, f, now]);
  const rows = useMemo(() => reportRows(snap, f, now), [snap, f, now]);
  const reasons = snap.reasons.slice().sort((a, b) => a.sort_order - b.sort_order);

  const describeFilters = () => {
    const p: string[] = [];
    p.push(f.from || f.to ? `${f.from ? fmtDateShort(f.from) : "start"} to ${f.to ? fmtDateShort(f.to) : "today"}` : "all dates");
    if (f.fellowId) p.push(L.fellow.get(f.fellowId)?.display_name ?? "");
    if (f.eventType) p.push(EVENT_TYPE_LABELS[f.eventType]);
    if (f.reasonId) p.push(`reason: ${L.reasonLabel(f.reasonId)}`);
    return p.join(" · ");
  };
  const slug = () => `${f.from ?? "start"}_to_${f.to ?? todayKey(now)}${f.eventType ? `_${f.eventType}` : ""}${f.fellowId ? `_${(L.fellow.get(f.fellowId)?.display_name ?? "").replace(/\W+/g, "-")}` : ""}${f.reasonId ? "_reason" : ""}`;

  const exportSummary = () => {
    const csv = toCsv(
      ["Fellow", "Placement", "Required events counted", "Events missed (all required)", "Speaker Series missed", "Present", "Not recorded", "Planned ahead (upcoming)", ...reasons.map((r) => `Missed: ${r.label}`)],
      totals.map((t) => [t.fellow.display_name, t.fellow.agency ?? "", t.eligibleEvents, t.eventsMissed, t.speakerSeriesMissed, t.present, t.notRecorded, t.plannedUpcoming, ...reasons.map((r) => t.byReason[r.id] ?? 0)]),
    );
    downloadCsv(`attendance-summary_${slug()}.csv`, csv);
  };
  const exportDetail = () => {
    const csv = toCsv(
      ["Date (ET)", "Start (ET)", "Event", "Type", "Fellow", "Status", "Counts as event missed", "Reason", "Note", "Last changed by", "Last changed at"],
      rows.map((r) => [
        r.event.local_date, fmtTime(r.event.starts_at), r.event.title, EVENT_TYPE_LABELS[r.event.event_type], r.fellow.display_name,
        STATUS_LABEL[r.status], isCountedAbsence(r, f) ? "Yes" : "No", r.status === "absent" ? L.reasonLabel(r.attendance?.reason_id) : "",
        r.status === "absent" ? r.attendance?.note ?? "" : "", r.attendance ? L.personName(r.attendance.updated_by) : "", r.attendance?.updated_at ?? "",
      ]),
    );
    downloadCsv(`attendance-detail_${slug()}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      <PageTitle title="Reports" subtitle="Totals and reasons for completed, required, non-canceled events. Exports match the filters below." />

      <Card>
        <h2 className="mb-3 font-serif text-[19px] font-semibold">Filters</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <label><span className="mb-1 block text-[13px] font-semibold">From</span><input type="date" className={inputCls} value={f.from ?? ""} onChange={(e) => set({ from: e.target.value || null })} /></label>
          <label><span className="mb-1 block text-[13px] font-semibold">Through</span><input type="date" className={inputCls} value={f.to ?? ""} onChange={(e) => set({ to: e.target.value || null })} /></label>
          <label><span className="mb-1 block text-[13px] font-semibold">Fellow</span>
            <select className={inputCls} value={f.fellowId ?? ""} onChange={(e) => set({ fellowId: e.target.value || null })}>
              <option value="">All Fellows</option>
              {sortFellows(snap.fellows).map((x) => <option key={x.id} value={x.id}>{x.display_name}</option>)}
            </select>
          </label>
          <label><span className="mb-1 block text-[13px] font-semibold">Event type</span>
            <select className={inputCls} value={f.eventType ?? ""} onChange={(e) => set({ eventType: (e.target.value || null) as EventType | null })}>
              <option value="">All required events</option>
              {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="col-span-2 lg:col-span-1"><span className="mb-1 block text-[13px] font-semibold">Absence reason</span>
            <select className={inputCls} value={f.reasonId ?? ""} onChange={(e) => set({ reasonId: e.target.value || null })}>
              <option value="">Any reason</option>
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}{!r.active && " (retired)"}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => setF(emptyFilters)}>Clear filters</Button>
          <span className="text-[14px] text-muted">Showing: {describeFilters()}</span>
        </div>
      </Card>

      <section>
        <SectionTitle>Class summary</SectionTitle>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile n={cls.eventsCounted} label="Required events counted" />
          <Tile n={cls.eventsMissed} label="Events missed (all required)" />
          <Tile n={cls.speakerSeriesMissed} label="Speaker Series missed" />
          <Tile n={cls.notRecorded} label={`Not recorded (across ${cls.unreviewedEvents} event${cls.unreviewedEvents === 1 ? "" : "s"})`} />
        </dl>
        <p className="mt-2 text-[13px] text-muted">
          One event missed = one confirmed absence by one Fellow at one event. Two events on the same day count as two.
          “Not recorded” is kept separate — it is never treated as present or absent. No percentages are shown because unreviewed records would make them misleading.
        </p>
      </section>

      <section>
        <SectionTitle aside={<div className="flex gap-2"><Button onClick={exportSummary}>Download summary CSV</Button><Button onClick={exportDetail}>Download detail CSV</Button></div>}>By Fellow</SectionTitle>
        <div className="overflow-x-auto rounded-2xl bg-card ring-1 ring-line">
          <table className="w-full min-w-[640px] text-left text-[15px]">
            <thead className="border-b border-line bg-paper text-[13px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Fellow</th>
                <th className="px-3 py-2 text-right font-semibold">Events counted</th>
                <th className="px-3 py-2 text-right font-semibold">Events missed</th>
                <th className="px-3 py-2 text-right font-semibold">Speaker Series missed</th>
                <th className="px-3 py-2 text-right font-semibold">Not recorded</th>
                <th className="px-3 py-2 text-right font-semibold">Planned ahead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular">
              {totals.map((t) => (
                <tr key={t.fellow.id}>
                  <td className="px-3 py-2 font-semibold">{t.fellow.display_name}</td>
                  <td className="px-3 py-2 text-right">{t.eligibleEvents}</td>
                  <td className="px-3 py-2 text-right font-semibold">{t.eventsMissed}</td>
                  <td className="px-3 py-2 text-right">{t.speakerSeriesMissed}</td>
                  <td className="px-3 py-2 text-right text-muted">{t.notRecorded}</td>
                  <td className="px-3 py-2 text-right text-gold-ink">{t.plannedUpcoming}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[13px] text-muted">Listed in roster order. “Planned ahead” counts upcoming required events with a planned absence; it is never added to events missed.</p>
      </section>

      <section>
        <SectionTitle>Events missed by reason</SectionTitle>
        {cls.eventsMissed ? (
          <ul className="divide-y divide-line rounded-2xl bg-card ring-1 ring-line">
            {Object.entries(cls.byReason).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
              <li key={r} className="flex justify-between px-4 py-2.5 text-[15px]"><span>{L.reasonLabel(r)}</span><span className="font-semibold tabular">{n}</span></li>
            ))}
          </ul>
        ) : <Empty>No confirmed absences for these filters.</Empty>}
      </section>
    </div>
  );
}

function Tile({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-xl bg-card px-3 py-3 ring-1 ring-line">
      <dd className="font-serif text-[28px] font-semibold leading-none tabular">{n}</dd>
      <dt className="mt-1 text-[13px] text-muted">{label}</dt>
    </div>
  );
}
