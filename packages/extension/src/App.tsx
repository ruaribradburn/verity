import { LiveVoiceSession } from "@packages/client";
import { ResearchPanel } from "./components/ResearchPanel";

const apiOrigin =
  import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

export default function App() {
  return (
    <div className="flex flex-col gap-4 p-3">
      <ResearchPanel />
      <LiveVoiceSession apiOrigin={apiOrigin} />
    </div>
  );
}
