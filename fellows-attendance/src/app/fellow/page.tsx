import { Suspense } from "react";
import FellowProfile from "./FellowProfile";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <FellowProfile />
    </Suspense>
  );
}
