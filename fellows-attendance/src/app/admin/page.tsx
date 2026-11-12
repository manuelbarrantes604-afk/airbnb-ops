"use client";

import { useCallback, useEffect, useState } from "react";
import { useSnap } from "@/lib/data";
import type { Fellow, Member, Reason } from "@/lib/types";
import { sortFellows } from "@/lib/rules";
import { useSaver } from "@/components/actions";
import { useToast } from "@/components/toast";
import { Avatar, Button, Card, Chips, Empty, Field, PageTitle, Pill, SaveStatus, SectionTitle, Sheet, inputCls } from "@/components/ui";

export default function AdminPage() {
  const { me } = useSnap();
  if (me?.member?.role !== "admin") {
    return <Card><Empty>Administration is limited to tracker administrators.</Empty></Card>;
  }
  return (
    <div className="space-y-8">
      <PageTitle title="Administration" subtitle="Managed by the VOPS committee. Changes here are logged like everything else." />
      <SettingsSection />
      <RosterSection />
      <PeopleSection />
      <ReasonsSection />
    </div>
  );
}

// ---------------------------------------------------------------- settings & ownership
function SettingsSection() {
  const { snap, backend } = useSnap();
  const saver = useSaver();
  const s = snap.settings;
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(s.program_name);
  const [label, setLabel] = useState(s.class_label);
  const [thr, setThr] = useState(String(s.warning_threshold));
  const [prov, setProv] = useState(s.threshold_is_provisional);
  const [primary, setPrimary] = useState(s.primary_owner_id ?? "");
  const [backup, setBackup] = useState(s.backup_owner_id ?? "");
  useEffect(() => { backend.listMembers().then(setMembers).catch(() => {}); }, [backend, snap.loadedAt]);
  const admins = members.filter((m) => m.active && m.role === "admin");
  const nm = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? "Not set";

  const save = () => {
    const n = Number(thr);
    if (!Number.isInteger(n) || n < 1 || n > 50) return saver.setState({ phase: "error", msg: "Threshold must be a whole number from 1 to 50." });
    if (primary && primary === backup) return saver.setState({ phase: "error", msg: "Primary and backup owner should be different people." });
    saver.run(() => backend.updateSettings(s.version, {
      program_name: name.trim() || "Fellows Attendance", class_label: label.trim(), warning_threshold: n, threshold_is_provisional: prov,
      primary_owner_id: primary || null, backup_owner_id: backup || null,
    }));
  };

  return (
    <section>
      <SectionTitle>Ownership & settings</SectionTitle>
      <Card>
        <p className="mb-4 text-[15px]">Current owners — primary: <strong>{nm(s.primary_owner_id)}</strong> · backup: <strong>{nm(s.backup_owner_id)}</strong></p>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Primary owner" htmlFor="own-p" hint="Must be an active administrator. Change this to transfer ownership.">
            <select id="own-p" className={inputCls} value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">Not set</option>
              {admins.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
          </Field>
          <Field label="Backup owner" htmlFor="own-b">
            <select id="own-b" className={inputCls} value={backup} onChange={(e) => setBackup(e.target.value)}>
              <option value="">Not set</option>
              {admins.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
          </Field>
          <Field label="App name" htmlFor="set-name"><input id="set-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Class label" htmlFor="set-label"><input id="set-label" className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label="Warning threshold (planned absences)" htmlFor="set-thr" hint="Upcoming events with this many planned absences or more are flagged on Overview.">
            <input id="set-thr" inputMode="numeric" className={inputCls} value={thr} onChange={(e) => setThr(e.target.value)} />
          </Field>
          <Field label="Threshold status">
            <Chips label="Threshold status" value={prov ? "p" : "c"} onChange={(v) => setProv(v === "p")}
              options={[{ value: "p", label: "Provisional" }, { value: "c", label: "Confirmed by program" }]} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={save} disabled={saver.saving}>{saver.saving ? "Saving…" : "Save settings"}</Button>
          <SaveStatus state={saver.state} />
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------- roster & portraits
async function resizeToJpeg(file: File, max = 640): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("That file couldn’t be read as an image. Try a JPEG or PNG."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(max, side);
    const c = document.createElement("canvas");
    c.width = out;
    c.height = out;
    const ctx = c.getContext("2d")!;
    // Center square crop; re-encoding also strips photo metadata such as location.
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not process image."))), "image/jpeg", 0.86));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function RosterSection() {
  const { snap } = useSnap();
  const [edit, setEdit] = useState<Fellow | "new" | null>(null);
  return (
    <section>
      <SectionTitle aside={<Button onClick={() => setEdit("new")}>Add Fellow</Button>}>Roster & portraits</SectionTitle>
      <p className="-mt-2 mb-3 text-[14px] text-muted">Replace the placeholders with real names and optional placements. Upload portraits only with each person’s permission. To remove someone from the roster, set a “last day on roster” — past records stay intact.</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sortFellows(snap.fellows).map((f) => (
          <li key={f.id} className="flex min-w-0 items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-line">
            <Avatar fellow={f} size={48} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{f.display_name}</p>
              <p className="truncate text-[13px] text-muted">{f.agency || "No placement"}{f.eligible_until && ` · until ${f.eligible_until}`}</p>
              {f.is_placeholder && <Pill tone="quiet">Placeholder</Pill>}
            </div>
            <Button onClick={() => setEdit(f)}>Edit</Button>
          </li>
        ))}
      </ul>
      {edit && <FellowSheet key={edit === "new" ? "new" : edit.id} fellow={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function FellowSheet({ fellow, onClose }: { fellow: Fellow | null; onClose: () => void }) {
  const { snap, backend, reload } = useSnap();
  const saver = useSaver();
  const toast = useToast();
  const latest = fellow ? snap.fellows.find((x) => x.id === fellow.id) ?? fellow : null;
  const [name, setName] = useState(fellow?.display_name ?? "");
  const [agency, setAgency] = useState(fellow?.agency ?? "");
  const [from, setFrom] = useState(fellow?.eligible_from ?? "");
  const [until, setUntil] = useState(fellow?.eligible_until ?? "");
  const [order, setOrder] = useState(String(fellow?.sort_order ?? snap.fellows.length + 1));
  const [photoState, setPhotoState] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return saver.setState({ phase: "error", msg: "Please enter a name." });
    if (from && until && until < from) return saver.setState({ phase: "error", msg: "The last day must be after the first day." });
    const input = {
      display_name: name.trim(), agency: agency.trim() || null, eligible_from: from || null, eligible_until: until || null,
      sort_order: Number(order) || 0, is_placeholder: fellow ? fellow.is_placeholder && name.trim() === fellow.display_name : false,
    };
    const r = await saver.run(() => (fellow ? backend.updateFellow(fellow, input) : backend.createFellow(input)));
    if (r) { onClose(); toast({ tone: "ok", msg: "Roster updated." }); }
  };

  const upload = async (file: File | undefined) => {
    if (!file || !latest) return;
    setPhotoState("Uploading…");
    try {
      const blob = await resizeToJpeg(file);
      const path = await backend.uploadPortrait(latest.id, blob);
      await backend.updateFellow(latest, { photo_path: path });
      await reload();
      setPhotoState("Portrait saved.");
    } catch (e) {
      setPhotoState(`Not saved: ${(e as Error).message}`);
      reload();
    }
  };
  const removePhoto = async () => {
    if (!latest) return;
    setPhotoState("Removing…");
    try {
      await backend.updateFellow(latest, { photo_path: null });
      await reload();
      setPhotoState("Portrait removed. Initials will show instead.");
    } catch (e) {
      setPhotoState(`Not saved: ${(e as Error).message}`);
    }
  };

  return (
    <Sheet open onClose={onClose} title={fellow ? `Edit ${fellow.display_name}` : "Add Fellow"}
      footer={<div className="space-y-2"><SaveStatus state={saver.state} /><div className="flex gap-2"><Button className="flex-1" onClick={onClose}>Close</Button><Button variant="primary" className="flex-[2]" disabled={saver.saving} onClick={save}>{saver.saving ? "Saving…" : "Save"}</Button></div></div>}>
      {latest && (
        <div className="mb-5 flex items-center gap-4">
          <Avatar fellow={latest} size={80} />
          <div className="space-y-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-card px-4 font-semibold ring-1 ring-line-strong hover:bg-paper">
              {latest.photo_path ? "Replace portrait" : "Upload portrait"}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
            {latest.photo_path && <Button variant="ghost" onClick={removePhoto}>Remove portrait</Button>}
            {photoState && <p role="status" className="text-[13px] text-muted">{photoState}</p>}
          </div>
        </div>
      )}
      <Field label="Name" htmlFor="fe-name"><input id="fe-name" className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Agency placement (optional)" htmlFor="fe-ag"><input id="fe-ag" className={inputCls} value={agency} maxLength={120} onChange={(e) => setAgency(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day on roster" htmlFor="fe-from" hint="Optional"><input id="fe-from" type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Last day on roster" htmlFor="fe-until" hint="Optional"><input id="fe-until" type="date" className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      </div>
      <Field label="Display order" htmlFor="fe-ord"><input id="fe-ord" inputMode="numeric" className={inputCls} value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
    </Sheet>
  );
}

// ---------------------------------------------------------------- people & access
function PeopleSection() {
  const { snap, backend, me } = useSnap();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inv, setInv] = useState(false);
  const toast = useToast();
  const load = useCallback(() => backend.listMembers().then((m) => { setMembers(m); setErr(null); }).catch((e) => setErr(e.message)), [backend]);
  useEffect(() => { load(); }, [load, snap.loadedAt]);

  const change = async (m: Member, patch: Partial<Member>, msg: string) => {
    try {
      await backend.updateMember({ user_id: m.user_id, version: m.version ?? 1 }, patch);
      toast({ tone: "ok", msg });
      load();
    } catch (e) {
      toast({ tone: "error", msg: (e as Error).message });
      load();
    }
  };
  const fname = (id: string | null) => snap.fellows.find((f) => f.id === id)?.display_name;

  return (
    <section>
      <SectionTitle aside={<Button variant="primary" onClick={() => setInv(true)}>Invite person</Button>}>People & access</SectionTitle>
      <p className="-mt-2 mb-3 text-[14px] text-muted">Accounts are separate from the roster: staff can sign in without counting as Fellows. Removing access takes effect immediately; history is kept.</p>
      {err && <p role="alert" className="text-absent">{err}</p>}
      {!members ? <p className="text-muted">Loading…</p> : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-line">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.display_name}{m.user_id === me?.userId && " (you)"}</p>
                <p className="truncate text-[13px] text-muted">{m.email}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Pill tone="quiet">{m.kind === "fellow" ? `Fellow${fname(m.fellow_id) ? ` · ${fname(m.fellow_id)}` : ""}` : "Program staff"}</Pill>
                  {m.role === "admin" && <Pill tone="navy">Administrator</Pill>}
                  {!m.active && <Pill tone="absent">Access removed</Pill>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {m.active && (m.role === "admin"
                  ? <Button onClick={() => change(m, { role: "member" }, `${m.display_name} is no longer an administrator.`)}>Remove admin</Button>
                  : <Button onClick={() => change(m, { role: "admin" }, `${m.display_name} is now an administrator.`)}>Make admin</Button>)}
                {m.active
                  ? <Button variant="danger" onClick={() => { if (confirm(`Remove access for ${m.display_name}? They will no longer be able to see or edit the tracker.`)) change(m, { active: false }, "Access removed."); }}>Remove access</Button>
                  : <Button onClick={() => change(m, { active: true }, "Access restored.")}>Restore access</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {inv && <InviteSheet onClose={() => { setInv(false); load(); }} taken={new Set((members ?? []).map((m) => m.fellow_id).filter(Boolean) as string[])} />}
    </section>
  );
}

function InviteSheet({ onClose, taken }: { onClose: () => void; taken: Set<string> }) {
  const { snap, backend } = useSnap();
  const saver = useSaver();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"fellow" | "staff">("fellow");
  const [fellowId, setFellowId] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const save = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return saver.setState({ phase: "error", msg: "Enter a valid email." });
    if (!name.trim()) return saver.setState({ phase: "error", msg: "Enter a display name." });
    if (kind === "fellow" && !fellowId) return saver.setState({ phase: "error", msg: "Choose which roster profile this Fellow is." });
    const r = await saver.run(() => backend.invite({ email: email.trim().toLowerCase(), display_name: name.trim(), kind, fellow_id: kind === "fellow" ? fellowId : null, role }).then(() => true),
      "Invitation created. Tell them to open the app and sign in with this email — they’ll get a code.");
    if (r) { setEmail(""); setName(""); setFellowId(""); }
  };
  return (
    <Sheet open onClose={onClose} title="Invite person" description="Creates an account for this email. The app sends no invitation email — tell them the address of the app."
      footer={<div className="space-y-2"><SaveStatus state={saver.state} /><div className="flex gap-2"><Button className="flex-1" onClick={onClose}>Done</Button><Button variant="primary" className="flex-[2]" disabled={saver.saving} onClick={save}>{saver.saving ? "Creating…" : "Create invitation"}</Button></div></div>}>
      <Field label="Email" htmlFor="iv-email"><input id="iv-email" type="email" autoCapitalize="none" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Display name" htmlFor="iv-name" hint="Shown in “changed by” labels."><input id="iv-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="This person is"><Chips label="Account type" value={kind} onChange={setKind} options={[{ value: "fellow", label: "A Fellow" }, { value: "staff", label: "Program staff" }]} /></Field>
      {kind === "fellow" && (
        <Field label="Roster profile" htmlFor="iv-f" hint="Links the account to their Fellow profile so “Record absence” defaults to them.">
          <select id="iv-f" className={inputCls} value={fellowId} onChange={(e) => { setFellowId(e.target.value); const f = snap.fellows.find((x) => x.id === e.target.value); if (f && !name) setName(f.display_name); }}>
            <option value="">Choose…</option>
            {sortFellows(snap.fellows).map((f) => <option key={f.id} value={f.id} disabled={taken.has(f.id)}>{f.display_name}{taken.has(f.id) ? " (already linked)" : ""}</option>)}
          </select>
        </Field>
      )}
      <Field label="Role"><Chips label="Role" value={role} onChange={setRole} options={[{ value: "member", label: "Member (can record & edit attendance)" }, { value: "admin", label: "Administrator" }]} /></Field>
    </Sheet>
  );
}

// ---------------------------------------------------------------- reasons
function ReasonsSection() {
  const { snap, backend } = useSnap();
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<Reason | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const list = snap.reasons.slice().sort((a, b) => a.sort_order - b.sort_order);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast({ tone: "ok", msg }); } catch (e) { toast({ tone: "error", msg: (e as Error).message }); }
  };
  return (
    <section>
      <SectionTitle>Absence reasons</SectionTitle>
      <p className="-mt-2 mb-3 text-[14px] text-muted">Starting categories are editable. Retiring a reason hides it from new entries but keeps it on past records. No excused/unexcused policy is applied.</p>
      <ul className="space-y-2">
        {list.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3 ring-1 ring-line">
            {editing?.id === r.id ? (
              <>
                <input aria-label="Reason label" className={`${inputCls} flex-1`} value={editLabel} maxLength={60} onChange={(e) => setEditLabel(e.target.value)} />
                <Button variant="primary" onClick={() => act(() => backend.updateReason(r, { label: editLabel.trim() }), "Reason renamed.").then(() => setEditing(null))}>Save</Button>
                <Button onClick={() => setEditing(null)}>Cancel</Button>
              </>
            ) : (
              <>
                <span className="flex-1 font-semibold">{r.label} {!r.active && <Pill tone="quiet">Retired</Pill>}</span>
                <Button onClick={() => { setEditing(r); setEditLabel(r.label); }}>Rename</Button>
                <Button onClick={() => act(() => backend.updateReason(r, { active: !r.active }), r.active ? "Reason retired." : "Reason restored.")}>{r.active ? "Retire" : "Restore"}</Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) act(() => backend.createReason(label.trim(), list.length + 1), "Reason added.").then(() => setLabel("")); }}>
        <input aria-label="New reason" placeholder="New reason" className={`${inputCls} flex-1`} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        <Button type="submit">Add</Button>
      </form>
    </section>
  );
}
