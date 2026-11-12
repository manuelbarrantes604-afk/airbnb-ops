import { Suspense } from "react";
import EventDetail from "./EventDetail";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <EventDetail />
    </Suspense>
  );
}
