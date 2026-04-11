"use client";

import { LiveVoiceSession } from "@packages/client";

const apiOrigin =
  process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

export default function Home() {
  return <LiveVoiceSession apiOrigin={apiOrigin} />;
}
