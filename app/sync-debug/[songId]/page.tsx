"use client";

import { use } from "react";
import { SyncDebugView } from "@/features/player/components/SyncDebugView";

export default function SyncDebugPage({
  params,
}: {
  params: Promise<{ songId: string }>;
}) {
  const { songId } = use(params);
  return <SyncDebugView songId={songId} />;
}
