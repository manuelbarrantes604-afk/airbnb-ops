"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useData, useLookups, useSnap } from "@/lib/data";
import type { CalEvent, Fellow, TimeAway } from "@/lib/types";
import { EVENT_TYPE_LABELS, type EventType } from "@/lib/types";
import {
  attendanceFor, eligibleFellows, eventsInRange, hasStarted, isEligible, planFor, sortFellows,
} from "@/lib/rules";
import {
  addDays, fmtDateMedium, fmtDateShort, fmtTime, nyTimeKey, nyToUtc, todayKey, weekdayOf,
} from "@/lib/time";
import { toAppError } from "@/lib/backend/types";
import { Avatar, Button, Chips, Field, Pill, SaveStatus, Sheet, cx, inputCls, type SaveState } from "./ui";
import { useToast } from "./toast";

// ---------------------------------------------------------------- context
interface Actions {
  recordAbsence: (o?: { eventId?: string; fellowId?: string }) => void;
  planAway: (o?: { fellowId?: string; range?: TimeAway }) => void;
  editEvent: (o?: { event?: CalEvent; date?: string }) => void;
  repeatEvents: () => void;
}
const Ctx = createContext<Actions | null>(null);
export const useActions = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useActions outside provider");
  return c;
};

export function ActionsProvider({ children }: { children: React.ReactNode }) {
  const [rec, setRec] = useState<{ eventId?: string; fellowId?: string } | null>(null);
  const [away, setAway] = useState<{ fellowId?: string; range?: TimeAway } | null>(null);
  const [ev, setEv] = useState<{ event?: CalEvent; date?: string } | null>(null);
  const [rep, setRep] = useState(false);
  const value = useMemo<Actions>(() => ({
    recordAbsence: (o) => setRec(o ?? {}),
    planAway: (o) => setAway(o ?? {}),
    editEvent: (o) => setEv(o ?? {}),
    repeatEvents: () => setRep(true),
  }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {rec && <RecordAbsenceSheet key={JSON.stringify(rec)} init={rec} onClose={() => setRec(null)} />}
      {away && <PlanAwaySheet key={away.range?.id ?? "new"} init={away} onClose={() => setAway(null)} />}
      {ev && <EventSheet key={ev.event?.id ?? "new"} init={ev} onClose={() => setEv(null)} />}
      {rep && <RepeatSheet onClose={() => setRep(false)} />}
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------- saving helper
/** Wraps a save: shows Saving…, only reports success after the server confirms,
 *  and reloads on conflicts so the newest data is shown. */
export function useSaver() {
  const { reload } = useData();
  const [state, setState] = useState<SaveState>({ phase: "idle" });
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setState({ phase: "saving" });
    try {
      const r = await fn();
      setState({ phase: "saved", msg: okMsg });
      reload();
      return r;
    } catch (e) {
      const err = toAppError(e);
      setState({ phase: "error", msg: err.message });
      if (err.code === "stale_version") reload();
      return undefined;
    }
  }, [reload]);
  return { state, run, setState, saving: state.phase === "saving" };
}

// ---------------------------------------------------------------- shared bits
function FellowPicker({ fellows, value, onChange }: { fellows: Fellow[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Fellow" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {fellows.map((f) => {
        const on = f.id === value;
        return (
          <button key={f.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(f.id)}
            className={cx("flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[13px] font-semibold ring-1",
              on ? "bg-navy text-white ring-navy" : "bg-card ring-line hover:bg-paper")}>
            <Avatar fellow={f} size={40} ring={on ? "gold" : null} />
            <span className="line-clamp-2 leading-tight">{f.display_name}</span>
          </button>
        );
      })}
    </div>
  );
}

function ReasonChips({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const { snap } = useSnap();
  const opts = snap.reasons.filter((r) => r.active || r.id === value).sort((a, b) => a.sort_order - b.sort_order).map((r) => ({ value: r.id, label: r.label }));
  return <Chips label="Reason" options={opts} value={value} onChange={onChange} />;
}

const privacyHint = "Reasons and notes are visible to everyone invited to this tracker. Don’t include medical or other sensitive details.";

function eventOptionLabel(e: CalEvent) {
  return `${fmtDateMedium(e.local_date)} · ${fmtTime(e.starts_at)} — ${e.title}`;
}

// ---------------------------------------------------------------- Record absence
function RecordAbsenceSheet({ init, onClose }: { init: { eventId?: string; fellowId?: string }; onClose: () => void }) {
  const { snap, now, me, backend } = useSnap();
  const L = useLookups();
  const toast = useToast();
  const saver = useSaver();

  const choices = useMemo(() => {
    const from = addDays(todayKey(now), -21);
    return snap.events
      .filter((e) => e.status === "scheduled" && (e.local_date >= from || e.id === init.eventId))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [snap.events, now, init.eventId]);

  const defaultEvent = useMemo(() => {
    if (init.eventId) return init.eventId;
    const today = todayKey(now);
    const startedToday = choices.filter((e) => e.local_date === today && hasStarted(e, now));
    if (startedToday.length) return startedToday[startedToday.length - 1].id;
    return choices.find((e) => !hasStarted(e, now))?.id ?? choices[choices.length - 1]?.id ?? "";
  }, [choices, init.eventId, now]);

  const myFellow = me?.member?.kind === "fellow" ? me.member.fellow_id : null;
  const [eventId, setEventId] = useState(defaultEvent);
  const [fellowId, setFellowId] = useState<string | null>(init.fellowId ?? myFellow ?? null);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const ev = L.event.get(eventId);
  const future = ev ? !hasStarted(ev, now) : true;
  const fellows = ev ? eligibleFellows(snap, ev) : sortFellows(snap.fellows);
  const fellow = fellowId ? L.fellow.get(fellowId) : undefined;
  const ineligible = !!(ev && fellow && !isEligible(fellow, ev.local_date));

  // Version this form is based on (captured when the selection changes, not at save time),
  // so a concurrent edit by someone else is detected instead of overwritten.
  const [base, setBase] = useState<{ key: string; version: number | null }>({ key: "", version: null });
  const key = `${eventId}|${fellowId}|${future}`;
  const currentAtt = ev && fellowId ? attendanceFor(snap, fellowId, ev.id) : null;
  const currentPlan = ev && fellowId ? planFor(snap, fellowId, ev) : null;
  if (base.key !== key) {
    const v = future ? currentPlan?.eventPlan?.version ?? null : currentAtt?.version ?? null;
    setBase({ key, version: v });
    if (future && currentPlan?.planned) setReasonId(currentPlan.reasonId);
    else if (!future && currentAtt?.status === "absent") setReasonId(currentAtt.reason_id);
  }

  const save = async () => {
    if (!ev || !fellowId) return;
    if (!reasonId) return saver.setState({ phase: "error", msg: "Please choose a reason." });
    const f = L.fellow.get(fellowId)!;
    const res = await saver.run(async () => {
      if (future) {
        return { kind: "plan" as const, row: await backend.setEventPlan({ fellowId, eventId: ev.id, kind: "absent", reasonId, note, expectedVersion: base.version }) };
      }
      return { kind: "att" as const, row: await backend.recordAttendance({ fellowId, eventId: ev.id, status: "absent", reasonId, note, expectedVersion: base.version }) };
    });
    if (!res) return;
    onClose();
    toast({
      tone: "ok",
      msg: `${future ? "Planned absence saved" : "Absence recorded"} for ${f.display_name} · ${fmtDateMedium(ev.local_date)}`,
      action: {
        label: "Undo absence",
        run: async () => {
          if (res.kind === "plan") {
            await backend.setEventPlan({ fellowId, eventId: ev.id, kind: null, reasonId: null, note: null, expectedVersion: res.row?.version ?? null });
          } else {
            await backend.recordAttendance({ fellowId, eventId: ev.id, status: "not_recorded", reasonId: null, note: null, expectedVersion: res.row.version });
          }
          toast({ tone: "ok", msg: "Absence undone. History is kept." });
        },
      },
    });
  };

  return (
    <Sheet open onClose={onClose} title="Record absence"
      footer={
        <div className="space-y-2">
          <SaveStatus state={saver.state} />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onClose}>Cancel</Button>
            <Button variant="primary" className="flex-[2]" onClick={save} disabled={saver.saving || !ev || !fellowId || ineligible}>
              {saver.saving ? "Saving…" : future ? "Save planned absence" : "Record absence"}
            </Button>
          </div>
        </div>
      }>
      <Field label="Event" htmlFor="rec-event">
        <select id="rec-event" className={inputCls} value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {choices.map((e) => (
            <option key={e.id} value={e.id}>{eventOptionLabel(e)}</option>
          ))}
        </select>
      </Field>
      {ev && (
        <p className={cx("-mt-2 mb-4 rounded-xl px-3 py-2 text-[14px] ring-1", future ? "bg-gold-soft text-gold-ink ring-gold/40" : "bg-absent-soft text-absent ring-absent/30")}>
          {future
            ? "This event hasn’t happened yet, so this is saved as a planned absence. It won’t count as an actual absence unless confirmed after the event."
            : "This event has started or ended, so this is recorded as an actual (confirmed) absence."}
        </p>
      )}

      <Field label={myFellow && fellowId === myFellow ? "Fellow (you)" : "Fellow"}>
        <FellowPicker fellows={fellows} value={fellowId} onChange={setFellowId} />
      </Field>
      {ineligible && <p className="-mt-2 mb-4 text-[14px] text-absent">This Fellow isn’t on the roster for this event’s date.</p>}

      {fellow && ev && (future ? currentPlan?.planned : currentAtt?.status === "absent") && (
        <p className="-mt-1 mb-4 rounded-xl bg-paper px-3 py-2 text-[14px] ring-1 ring-line">
          Already {future ? `planned (${L.reasonLabel(currentPlan!.reasonId)}${currentPlan!.source === "range" ? ", from time away" : ""})` : `recorded absent (${L.reasonLabel(currentAtt!.reason_id)})`}.
          Saving updates the existing record — it never creates a duplicate.
        </p>
      )}

      <Field label="Reason">
        <ReasonChips value={reasonId} onChange={setReasonId} />
      </Field>
      <Field label="Note (optional)" htmlFor="rec-note" hint={privacyHint}>
        <input id="rec-note" className={inputCls} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Back by 2 pm" />
      </Field>
      <p className="text-[13px] text-muted">Saved as <strong>{me?.member?.display_name}</strong>{fellow && <> for <strong>{fellow.display_name}</strong></>}.</p>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Plan time away
function PlanAwaySheet({ init, onClose }: { init: { fellowId?: string; range?: TimeAway }; onClose: () => void }) {
  const { snap, now, me, backend } = useSnap();
  const L = useLookups();
  const toast = useToast();
  const saver = useSaver();
  const editing = init.range;
  const myFellow = me?.member?.kind === "fellow" ? me.member.fellow_id : null;
  const today = todayKey(now);

  const [fellowId, setFellowId] = useState<string | null>(editing?.fellow_id ?? init.fellowId ?? myFellow ?? null);
  const [start, setStart] = useState(editing?.start_date ?? today);
  const [end, setEnd] = useState(editing?.end_date ?? addDays(today, 6));
  const [reasonId, setReasonId] = useState<string | null>(editing?.reason_id ?? null);
  const [note, setNote] = useState(editing?.note ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const valid = !!fellowId && !!start && !!end && end >= start && !!reasonId;
  const inRange = start && end && end >= start ? eventsInRange(snap, start, end).filter((e) => e.status === "scheduled") : [];
  const upcomingIn = inRange.filter((e) => !hasStarted(e, now));
  const pastIn = inRange.filter((e) => hasStarted(e, now));
  const overlaps = snap.timeAway.filter((r) => r.fellow_id === fellowId && !r.removed_at && r.id !== editing?.id && r.start_date <= end && r.end_date >= start);

  // When editing: which upcoming events change status?
  const diff = useMemo(() => {
    if (!editing || !fellowId) return null;
    const without = { ...snap, timeAway: snap.timeAway.filter((r) => r.id !== editing.id) };
    const withNew = { ...snap, timeAway: [...without.timeAway, { ...editing, fellow_id: fellowId, start_date: start, end_date: end }] };
    const added: CalEvent[] = [], removed: CalEvent[] = [];
    for (const e of snap.events.filter((x) => x.status === "scheduled" && !hasStarted(x, now))) {
      const before = planFor(snap, editing.fellow_id, e).planned;
      const after = planFor(withNew, fellowId, e).planned;
      if (before && !after) removed.push(e);
      if (!before && after) added.push(e);
    }
    return { added, removed };
  }, [editing, fellowId, start, end, snap, now]);

  const save = async () => {
    if (!valid) return saver.setState({ phase: "error", msg: !reasonId ? "Please choose a reason." : "Please check the Fellow and dates." });
    const input = { fellow_id: fellowId!, start_date: start, end_date: end, reason_id: reasonId, note: note.trim() || null };
    const r = await saver.run(() => (editing ? backend.updateTimeAway(editing, input) : backend.createTimeAway(input)));
    if (!r) return;
    onClose();
    toast({
      tone: "ok",
      msg: `Time away ${editing ? "updated" : "saved"} for ${L.fellow.get(fellowId!)?.display_name}: ${fmtDateShort(start)} – ${fmtDateShort(end)}`,
      action: editing ? undefined : {
        label: "Undo",
        run: async () => {
          await backend.updateTimeAway(r, { removed_at: new Date().toISOString() });
          toast({ tone: "ok", msg: "Time away removed. History is kept." });
        },
      },
    });
  };

  const remove = async () => {
    if (!editing) return;
    const r = await saver.run(() => backend.updateTimeAway(editing, { removed_at: new Date().toISOString() }));
    if (!r) return;
    onClose();
    toast({ tone: "ok", msg: "Time away removed.", action: { label: "Undo", run: async () => { await backend.updateTimeAway(r, { removed_at: null }); } } });
  };

  return (
    <Sheet open onClose={onClose} title={editing ? "Edit time away" : "Plan time away"} description="For training, travel or any stretch of days. Covers every event in the dates — including events added later."
      footer={
        <div className="space-y-2">
          <SaveStatus state={saver.state} />
          {confirmRemove ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-[14px]">Remove this time away? Upcoming events will no longer show these planned absences.</span>
              <Button onClick={() => setConfirmRemove(false)}>Keep</Button>
              <Button variant="danger" onClick={remove} disabled={saver.saving}>Remove</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              {editing && <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove</Button>}
              <Button className="flex-1" onClick={onClose}>Cancel</Button>
              <Button variant="primary" className="flex-[2]" onClick={save} disabled={saver.saving || !valid}>
                {saver.saving ? "Saving…" : editing ? "Save changes" : "Save time away"}
              </Button>
            </div>
          )}
        </div>
      }>
      <Field label="Fellow">
        <FellowPicker fellows={sortFellows(snap.fellows)} value={fellowId} onChange={setFellowId} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day away" htmlFor="ta-start">
          <input id="ta-start" type="date" className={inputCls} value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
        </Field>
        <Field label="Last day away" htmlFor="ta-end">
          <input id="ta-end" type="date" className={inputCls} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <p className="-mt-2 mb-4 text-[13px] text-muted">Both dates are included.</p>
      <Field label="Reason">
        <ReasonChips value={reasonId} onChange={setReasonId} />
      </Field>
      <Field label="Note (optional)" htmlFor="ta-note" hint={privacyHint}>
        <input id="ta-note" className={inputCls} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <div className="rounded-xl bg-paper p-3 ring-1 ring-line">
        <h3 className="mb-1 text-[15px] font-semibold">Preview</h3>
        {end < start ? <p className="text-[14px] text-absent">The last day must be on or after the first day.</p> : (
          <>
            <p className="text-[14px]">
              {upcomingIn.length === 0 ? "No upcoming events are on the calendar in these dates yet." : `${upcomingIn.length} upcoming event${upcomingIn.length === 1 ? "" : "s"} will show a planned absence:`}
            </p>
            {upcomingIn.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[14px]">
                {upcomingIn.map((e) => {
                  const p = fellowId ? planFor(snap, fellowId, e) : null;
                  return (
                    <li key={e.id} className="flex justify-between gap-2">
                      <span>{fmtDateMedium(e.local_date)} · {e.title}</span>
                      {p?.exception && <span className="shrink-0 text-[12px] text-present">Will attend (exception)</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[13px] text-muted">Events added later within these dates will pick this up automatically.</p>
            {pastIn.length > 0 && <p className="mt-1 text-[13px] text-muted">{pastIn.length} event{pastIn.length === 1 ? " has" : "s have"} already started in these dates. Their attendance is confirmed separately and won’t be changed.</p>}
            {overlaps.length > 0 && <p className="mt-1 text-[13px] text-gold-ink">Overlaps other time away ({overlaps.map((o) => `${fmtDateShort(o.start_date)}–${fmtDateShort(o.end_date)}`).join(", ")}). Each event is still counted once.</p>}
            {diff && (diff.added.length > 0 || diff.removed.length > 0) && (
              <p className="mt-1 text-[13px] text-navy">This change: {diff.added.length} newly planned, {diff.removed.length} no longer planned.</p>
            )}
          </>
        )}
      </div>
      <p className="mt-3 text-[13px] text-muted">Can attend one event during this time? Open that event and choose “Will attend this one.”</p>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Event create / edit
const TYPE_OPTS = (Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((v) => ({ value: v, label: EVENT_TYPE_LABELS[v] }));

function EventSheet({ init, onClose }: { init: { event?: CalEvent; date?: string }; onClose: () => void }) {
  const { snap, now, backend } = useSnap();
  const toast = useToast();
  const saver = useSaver();
  const e = init.event;
  const [title, setTitle] = useState(e?.title ?? "");
  const [type, setType] = useState<EventType>(e?.event_type ?? "speaker_series");
  const [date, setDate] = useState(e ? e.local_date : init.date ?? todayKey(now));
  const [start, setStart] = useState(e ? nyTimeKey(e.starts_at) : "12:00");
  const [end, setEnd] = useState(e ? nyTimeKey(e.ends_at) : "13:30");
  const [speaker, setSpeaker] = useState(e?.speaker ?? "");
  const [location, setLocation] = useState(e?.location ?? "");
  const [desc, setDesc] = useState(e?.description ?? "");
  const [required, setRequired] = useState(e?.attendance_required ?? true);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const startsAt = date && start ? nyToUtc(date, start) : null;
  const endsAt = date && end ? nyToUtc(date, end) : null;
  const valid = title.trim().length > 0 && startsAt && endsAt && endsAt > startsAt;
  const recorded = e ? snap.attendance.filter((a) => a.event_id === e.id && a.status !== "not_recorded").length : 0;
  const timeChanged = e && startsAt && endsAt && (startsAt.toISOString() !== new Date(e.starts_at).toISOString() || endsAt.toISOString() !== new Date(e.ends_at).toISOString());

  const save = async () => {
    if (!valid) return saver.setState({ phase: "error", msg: "Please add a title and make sure the end time is after the start time." });
    const input = {
      title: title.trim(), event_type: type, starts_at: startsAt!.toISOString(), ends_at: endsAt!.toISOString(),
      speaker: speaker.trim() || null, location: location.trim() || null, description: desc.trim() || null, attendance_required: required,
    };
    const r = await saver.run(() => (e ? backend.updateEvent(e, input) : backend.createEvents([input]).then((x) => x[0])));
    if (!r) return;
    onClose();
    toast({ tone: "ok", msg: e ? "Event updated." : `Event added: ${input.title}` });
  };

  const setStatus = async (status: "scheduled" | "canceled") => {
    if (!e) return;
    const r = await saver.run(() => backend.updateEvent(e, { status }));
    if (!r) return;
    onClose();
    toast({
      tone: "ok", msg: status === "canceled" ? "Event canceled. It stays on the calendar, marked canceled." : "Event restored.",
      action: { label: "Undo", run: async () => { await backend.updateEvent(r, { status: status === "canceled" ? "scheduled" : "canceled" }); } },
    });
  };

  return (
    <Sheet open onClose={onClose} title={e ? "Edit event" : "Add event"}
      footer={
        <div className="space-y-2">
          <SaveStatus state={saver.state} />
          {confirmCancel ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-[14px]">Cancel this event? It stays visible as canceled and won’t count toward totals.</span>
              <Button onClick={() => setConfirmCancel(false)}>Keep</Button>
              <Button variant="danger" onClick={() => setStatus("canceled")} disabled={saver.saving}>Cancel event</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {e && e.status === "scheduled" && <Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel event…</Button>}
              {e && e.status === "canceled" && <Button onClick={() => setStatus("scheduled")}>Restore event</Button>}
              <Button className="flex-1" onClick={onClose}>Close</Button>
              <Button variant="primary" className="flex-[2]" onClick={save} disabled={saver.saving || !valid}>{saver.saving ? "Saving…" : e ? "Save changes" : "Add event"}</Button>
            </div>
          )}
        </div>
      }>
      <Field label="Title" htmlFor="ev-title">
        <input id="ev-title" className={inputCls} value={title} maxLength={140} onChange={(x) => setTitle(x.target.value)} placeholder="e.g. Speaker Series: Topic" />
      </Field>
      <Field label="Type">
        <Chips label="Event type" options={TYPE_OPTS} value={type} onChange={setType} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="ev-date"><input id="ev-date" type="date" className={inputCls} value={date} onChange={(x) => setDate(x.target.value)} /></Field>
        <Field label="Starts (ET)" htmlFor="ev-start"><input id="ev-start" type="time" className={inputCls} value={start} onChange={(x) => setStart(x.target.value)} /></Field>
        <Field label="Ends (ET)" htmlFor="ev-end"><input id="ev-end" type="time" className={inputCls} value={end} onChange={(x) => setEnd(x.target.value)} /></Field>
      </div>
      <p className="-mt-2 mb-4 text-[13px] text-muted">Times are Eastern Time (Washington, DC), adjusted automatically for daylight saving.</p>
      {timeChanged && recorded > 0 && (
        <p className="-mt-2 mb-4 rounded-xl bg-gold-soft px-3 py-2 text-[14px] text-gold-ink ring-1 ring-gold/40">
          This event already has {recorded} attendance record{recorded === 1 ? "" : "s"}. Rescheduling keeps them but flags the event for review.
        </p>
      )}
      <Field label="Attendance">
        <Chips label="Attendance" value={required ? "req" : "opt"} onChange={(v) => setRequired(v === "req")}
          options={[{ value: "req", label: "Required" }, { value: "opt", label: "Optional" }]} />
      </Field>
      <Field label="Speaker (optional)" htmlFor="ev-speaker"><input id="ev-speaker" className={inputCls} value={speaker} maxLength={140} onChange={(x) => setSpeaker(x.target.value)} /></Field>
      <Field label="Location (optional)" htmlFor="ev-loc"><input id="ev-loc" className={inputCls} value={location} maxLength={140} onChange={(x) => setLocation(x.target.value)} /></Field>
      <Field label="Short description (optional)" htmlFor="ev-desc"><textarea id="ev-desc" rows={3} className={inputCls} value={desc} maxLength={1000} onChange={(x) => setDesc(x.target.value)} /></Field>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Repeat helper (proposes dates; never auto-creates)
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function RepeatSheet({ onClose }: { onClose: () => void }) {
  const { snap, now, backend } = useSnap();
  const toast = useToast();
  const saver = useSaver();
  const today = todayKey(now);
  const [title, setTitle] = useState("Speaker Series");
  const [type, setType] = useState<EventType>("speaker_series");
  const [days, setDays] = useState<number[]>([2, 4]);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 56));
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:30");
  const [location, setLocation] = useState("");
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const proposed = useMemo(() => {
    const out: string[] = [];
    if (!from || !to || to < from) return out;
    for (let d = from; d <= to && out.length < 200; d = addDays(d, 1)) if (days.includes(weekdayOf(d))) out.push(d);
    return out;
  }, [from, to, days]);
  const existingOn = (d: string) => snap.events.filter((e) => e.local_date === d && e.status === "scheduled");
  const chosen = proposed.filter((d) => !unchecked.has(d));
  const valid = title.trim() && chosen.length > 0 && end > start;

  const create = async () => {
    const list = chosen.map((d) => ({
      title: title.trim(), event_type: type, starts_at: nyToUtc(d, start).toISOString(), ends_at: nyToUtc(d, end).toISOString(),
      speaker: null, location: location.trim() || null, description: null, attendance_required: true, series_id: crypto.randomUUID(),
    }));
    const sid = list[0]?.series_id;
    list.forEach((l) => (l.series_id = sid));
    const r = await saver.run(() => backend.createEvents(list));
    if (!r) return;
    onClose();
    toast({ tone: "ok", msg: `${r.length} events added. Edit any one to add a speaker or change details.` });
  };

  return (
    <Sheet open wide onClose={onClose} title="Add repeating events" description="Proposes dates for you to confirm. Nothing is added until you press Add."
      footer={
        <div className="space-y-2">
          <SaveStatus state={saver.state} />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onClose}>Cancel</Button>
            <Button variant="primary" className="flex-[2]" disabled={!valid || saver.saving} onClick={create}>
              {saver.saving ? "Adding…" : `Add ${chosen.length} event${chosen.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      }>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="rp-title"><input id="rp-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Location (optional)" htmlFor="rp-loc"><input id="rp-loc" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      </div>
      <Field label="Type"><Chips label="Event type" options={TYPE_OPTS} value={type} onChange={setType} /></Field>
      <Field label="Days of the week">
        <div className="flex flex-wrap gap-2">
          {WD.map((w, i) => {
            const on = days.includes(i);
            return (
              <button key={w} type="button" aria-pressed={on} onClick={() => setDays((d) => (on ? d.filter((x) => x !== i) : [...d, i]))}
                className={cx("min-h-11 min-w-14 rounded-xl px-3 text-[15px] font-semibold ring-1", on ? "bg-navy text-white ring-navy" : "bg-card ring-line-strong")}>{w}</button>
            );
          })}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="From" htmlFor="rp-from"><input id="rp-from" type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Through" htmlFor="rp-to"><input id="rp-to" type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Starts (ET)" htmlFor="rp-s"><input id="rp-s" type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ends (ET)" htmlFor="rp-e"><input id="rp-e" type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <h3 className="mb-2 text-[15px] font-semibold">Proposed dates ({chosen.length} of {proposed.length} selected)</h3>
      <p className="mb-2 text-[13px] text-muted">Untick holidays or any date that isn’t really happening.</p>
      <ul className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {proposed.map((d) => {
          const others = existingOn(d);
          return (
            <li key={d}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-paper">
                <input type="checkbox" className="h-5 w-5 accent-[#14213d]" checked={!unchecked.has(d)}
                  onChange={() => setUnchecked((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })} />
                <span className="text-[15px]">{fmtDateMedium(d)}</span>
                {others.length > 0 && <Pill tone="quiet">{others.length} already that day</Pill>}
              </label>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

