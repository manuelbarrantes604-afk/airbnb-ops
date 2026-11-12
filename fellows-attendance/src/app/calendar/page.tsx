"use client";

import { useMemo, useState } from "react";
import { useSnap } from "@/lib/data";
import type { CalEvent, EventType } from "@/lib/types";
import { EVENT_TYPE_LABELS } from "@/lib/types";
import { eventSummary, hasStarted, sortFellows } from "@/lib/rules";
import { addDays, addMonths, fmtDateLong, fmtMonth, monthKey, todayKey, weekdayOf } from "@/lib/time";
import { useActions } from "@/components/actions";
import { EventRow } from "@/components/EventBits";
import { Button, Empty, PageTitle, Segmented, cx, inputCls } from "@/components/ui";

type View = "agenda" | "month";

export default function CalendarPage() {
  const { snap, now } = useSnap();
  const actions = useActions();
  const today = todayKey(now);
  // Remembered per viewer (convenience only). Screens render client-side after sign-in.
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem("fa-cal-view") === "month" ? "month" : "agenda";
    } catch {
      return "agenda";
    }
  });
  const [type, setType] = useState<EventType | "">("");
  const [fellow, setFellow] = useState("");
  const [showCanceled, setShowCanceled] = useState(true);
  const [pastWeeks, setPastWeeks] = useState(0);
  const [month, setMonth] = useState(monthKey(today));
  const [day, setDay] = useState<string | null>(today);

  const changeView = (v: View) => {
    setView(v);
    try { localStorage.setItem("fa-cal-view", v); } catch { /* ignore */ }
  };

  const filtered = useMemo(
    () => snap.events
      .filter((e) => !type || e.event_type === type)
      .filter((e) => showCanceled || e.status !== "canceled")
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [snap.events, type, showCanceled],
  );

  return (
    <div>
      <PageTitle title="Calendar" subtitle="All times Eastern (Washington, DC)."
        actions={<>
          <Button variant="primary" onClick={() => actions.editEvent({ date: view === "month" && day ? day : undefined })}>Add event</Button>
          <Button onClick={() => actions.repeatEvents()}>Add repeating…</Button>
        </>} />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Segmented label="View" value={view} onChange={changeView} options={[{ value: "agenda", label: "Agenda" }, { value: "month", label: "Month" }]} />
        <label className="min-w-40 flex-1 sm:flex-none">
          <span className="mb-1 block text-[13px] font-semibold">Event type</span>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as EventType | "")}>
            <option value="">All types</option>
            {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="min-w-40 flex-1 sm:flex-none">
          <span className="mb-1 block text-[13px] font-semibold">Fellow</span>
          <select className={inputCls} value={fellow} onChange={(e) => setFellow(e.target.value)}>
            <option value="">Everyone</option>
            {sortFellows(snap.fellows).map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[15px]">
          <input type="checkbox" className="h-5 w-5 accent-[#14213d]" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} />
          Show canceled
        </label>
      </div>

      {view === "agenda" ? (
        <Agenda events={filtered} from={addDays(today, -7 - pastWeeks * 28)} fellow={fellow || null} onEarlier={() => setPastWeeks((w) => w + 1)} />
      ) : (
        <Month events={filtered} month={month} setMonth={setMonth} day={day} setDay={setDay} fellow={fellow || null} today={today} nowDate={now} />
      )}
    </div>
  );
}

function groupByDate(events: CalEvent[]) {
  const m = new Map<string, CalEvent[]>();
  for (const e of events) m.set(e.local_date, [...(m.get(e.local_date) ?? []), e]);
  return [...m.entries()];
}

function Agenda({ events, from, fellow, onEarlier }: { events: CalEvent[]; from: string; fellow: string | null; onEarlier: () => void }) {
  const shown = events.filter((e) => e.local_date >= from);
  const hiddenEarlier = events.some((e) => e.local_date < from);
  const groups = groupByDate(shown).map(([date, evs], i, all) => ({
    date, evs, header: i === 0 || monthKey(all[i - 1][0]) !== monthKey(date) ? monthKey(date) : null,
  }));
  return (
    <div>
      {hiddenEarlier && <Button className="mb-4" onClick={onEarlier}>Show earlier events</Button>}
      {!groups.length && <Empty>No events match these filters.</Empty>}
      <div className="space-y-4">
        {groups.map(({ date, evs, header }) => {
          return (
            <div key={date}>
              {header && <h2 className="mb-2 mt-6 font-serif text-[22px] font-semibold first:mt-0">{fmtMonth(header)}</h2>}
              <h3 className="sticky top-[60px] z-10 -mx-1 mb-2 bg-paper/95 px-1 py-1 text-[14px] font-semibold uppercase tracking-wide text-muted">{fmtDateLong(date)}{evs.length > 1 && ` · ${evs.length} events`}</h3>
              <ul className="space-y-2">{evs.map((e) => <li key={e.id}><EventRow ev={e} fellowFilter={fellow} /></li>)}</ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Month({ events, month, setMonth, day, setDay, fellow, today, nowDate }: {
  events: CalEvent[]; month: string; setMonth: (m: string) => void; day: string | null; setDay: (d: string) => void; fellow: string | null; today: string; nowDate: Date;
}) {
  const { snap } = useSnap();
  const first = `${month}-01`;
  const start = addDays(first, -weekdayOf(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const lastRowNeeded = cells.slice(35).some((d) => monthKey(d) === month);
  const grid = lastRowNeeded ? cells : cells.slice(0, 35);
  const byDate = new Map<string, CalEvent[]>();
  for (const e of events) byDate.set(e.local_date, [...(byDate.get(e.local_date) ?? []), e]);
  const dayEvents = day ? byDate.get(day) ?? [] : [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>‹</Button>
        <h2 className="font-serif text-[22px] font-semibold" aria-live="polite">{fmtMonth(month)}</h2>
        <div className="flex gap-2">
          <Button onClick={() => { setMonth(monthKey(today)); setDay(today); }}>Today</Button>
          <Button aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</Button>
        </div>
      </div>
      <div role="grid" aria-label={fmtMonth(month)} className="overflow-hidden rounded-2xl bg-line ring-1 ring-line">
        <div role="row" className="grid grid-cols-7 gap-px">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div role="columnheader" key={d} className="bg-paper py-1.5 text-center text-[12px] font-semibold uppercase tracking-wide text-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px">
          {grid.map((d) => {
            const evs = byDate.get(d) ?? [];
            const inMonth = monthKey(d) === month;
            const sel = d === day;
            const elevated = evs.some((e) => !hasStarted(e, nowDate) && eventSummary(snap, e).elevated);
            return (
              <button key={d} role="gridcell" aria-selected={sel} onClick={() => setDay(d)}
                aria-label={`${fmtDateLong(d)}: ${evs.length} event${evs.length === 1 ? "" : "s"}${elevated ? ", several planned absences" : ""}`}
                className={cx("flex min-h-16 flex-col items-stretch gap-0.5 p-1 text-left sm:min-h-24 sm:p-1.5",
                  inMonth ? "bg-card" : "bg-paper text-muted", sel && "outline outline-2 -outline-offset-2 outline-navy")}>
                <span className={cx("inline-flex h-7 w-7 items-center justify-center self-start rounded-full text-[14px] tabular", d === today && "bg-navy font-semibold text-white")}>{Number(d.slice(8))}</span>
                <span className="hidden flex-col gap-0.5 sm:flex">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id} className={cx("truncate rounded px-1 text-[12px] leading-5", e.status === "canceled" ? "bg-quiet text-muted line-through" : e.event_type === "speaker_series" ? "bg-gold-soft text-navy" : "bg-quiet text-navy")}>{e.title}</span>
                  ))}
                  {evs.length > 3 && <span className="text-[12px] text-muted">+{evs.length - 3} more</span>}
                </span>
                <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
                  {evs.map((e) => <span key={e.id} className={cx("h-1.5 w-1.5 rounded-full", e.status === "canceled" ? "bg-line-strong" : e.event_type === "speaker_series" ? "bg-gold" : "bg-navy-2")} />)}
                </span>
                {elevated && <span className="text-[11px] font-semibold text-gold-ink">⚠<span className="hidden sm:inline"> planned</span></span>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap gap-4 text-[13px] text-muted">
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-gold" />Speaker Series</span>
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-navy-2" />Other events</span>
        <span>⚠ several planned absences</span>
      </p>
      {day && (
        <div className="mt-5">
          <h3 className="mb-2 font-serif text-[20px] font-semibold">{fmtDateLong(day)}</h3>
          {dayEvents.length ? <ul className="space-y-2">{dayEvents.map((e) => <li key={e.id}><EventRow ev={e} fellowFilter={fellow} /></li>)}</ul> : <Empty>No events this day.</Empty>}
        </div>
      )}
    </div>
  );
}
