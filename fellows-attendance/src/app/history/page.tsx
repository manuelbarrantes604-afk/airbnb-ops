"use client";

import { AuditList } from "@/components/History";
import { PageTitle } from "@/components/ui";

export default function HistoryPage() {
  return (
    <div>
      <PageTitle title="Change history" subtitle="Every change is recorded with the signed-in person who made it. History can’t be edited or deleted from the app." />
      <AuditList limit={40} />
    </div>
  );
}
