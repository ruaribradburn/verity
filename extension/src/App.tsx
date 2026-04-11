import { LiveVoiceSession } from "@packages/client";

const apiOrigin =
  import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

export default function App() {
  return <LiveVoiceSession apiOrigin={apiOrigin} />;
}
