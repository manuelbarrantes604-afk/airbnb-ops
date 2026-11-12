"use client";

import { Card, PageTitle, SectionTitle } from "@/components/ui";

export default function HelpPage() {
  return (
    <div className="max-w-prose space-y-6">
      <PageTitle title="Help & privacy" />
      <Card>
        <SectionTitle>Add to your iPhone Home Screen</SectionTitle>
        <ol className="list-decimal space-y-1.5 pl-5 text-[16px]">
          <li>Open this site in <strong>Safari</strong>.</li>
          <li>Tap the <strong>Share</strong> button (square with an arrow).</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open <strong>Attendance</strong> from your Home Screen and sign in with your email code.</li>
        </ol>
        <p className="mt-3 text-[14px] text-muted">The Home Screen app keeps its own sign-in, separate from Safari, so you may need to sign in once in each.</p>
      </Card>
      <Card>
        <SectionTitle>Recording an absence (about 15 seconds)</SectionTitle>
        <ol className="list-decimal space-y-1.5 pl-5 text-[16px]">
          <li>Tap <strong>Record absence</strong> on Overview. The next event is already selected.</li>
          <li>Pick the Fellow (Fellows are pre-selected as themselves).</li>
          <li>Tap a reason, add a short note if you like, and tap Save.</li>
        </ol>
        <p className="mt-3 text-[15px]">Made a mistake? Tap <strong>Undo absence</strong> in the confirmation, or on the event page. Undo doesn’t mark anyone present — use <strong>Mark present</strong> for that.</p>
        <p className="mt-2 text-[15px]">Away for a stretch (e.g. military training)? Use <strong>Plan time away</strong> with a start and end date. It covers every event in those dates, including ones added later.</p>
      </Card>
      <Card>
        <SectionTitle>Who can see what</SectionTitle>
        <ul className="list-disc space-y-1.5 pl-5 text-[16px]">
          <li>Only invited people can sign in. Every invited Fellow and staff member can see the shared calendar, attendance, reasons and notes.</li>
          <li><strong>Don’t put medical or other sensitive details in notes.</strong> A reason category like “Illness” is enough.</li>
          <li>Every change is logged with the name of the signed-in person who made it.</li>
          <li>Planned absences are projections. People without a reported absence are not “confirmed attending.”</li>
          <li>This is a working tool for the class, not an official government system.</li>
        </ul>
      </Card>
    </div>
  );
}
