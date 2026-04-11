import React, { useState, useRef } from 'react';
import { GoogleGenAI, Tool } from '@google/genai';
import { Send, Settings, Play, ServerCog, ShieldAlert, Monitor, Mic, StopCircle, VideoOff } from 'lucide-react';

const DEFAULT_SYSTEM_PROMPT = `Stay concise, factual and neutral informative and direct in perspective.

Try not to agree with the user, and catch out any tonal statements that the user makes immediate report them. Keep the answer ideally less than 3 sentences, and add dry humour to keep it light.

Don't worry if you come across as too direct or factual, just play it off as your personality.

Proactively challenge users perspective and views with intelligent lines of questioning if needed.`;

const DEFAULT_TOOLS = `[
  {
    "functionDeclarations": [
      {
        "name": "verify_claim",
        "description": "Verifies a specific factual claim made in the text.",
        "parameters": {
          "type": "OBJECT",
          "properties": {
            "claim": {
              "type": "STRING",
              "description": "The specific claim to verify"
            },
            "sourceContext": {
              "type": "STRING",
              "description": "Context around the claim if any"
            }
          },
          "required": ["claim"]
        }
      }
    ]
  }
]`;

type Message = {
  role: 'user' | 'model';
  content: string;
  isToolCall?: boolean;
  toolCallConfig?: any;
};

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [toolsJson, setToolsJson] = useState(DEFAULT_TOOLS);
  const [temperature, setTemperature] = useState<number>(0.7);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Multimodal states
  const [isScreenPolling, setIsScreenPolling] = useState(false);
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const messagesRef = useRef<Message[]>([]);
  const latestFrameRef = useRef<string | null>(null);
  const apiKeyRef = useRef<string>('');
  const loadingRef = useRef<boolean>(false);

  React.useEffect(() => { messagesRef.current = messages; }, [messages]);
  React.useEffect(() => { latestFrameRef.current = latestFrame; }, [latestFrame]);
  React.useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  React.useEffect(() => { loadingRef.current = loading; }, [loading]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollingIntervalRef = useRef<any>(null);
  const proactiveIntervalRef = useRef<any>(null);

  const startScreenPoll = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error("Video play failed", e));
        
        pollingIntervalRef.current = setInterval(() => {
          if (videoRef.current && canvasRef.current) {
            const canvas = canvasRef.current;
            const video = videoRef.current;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                const base64 = dataUrl.split(',')[1];
                setLatestFrame(base64);
              }
            }
          }
        }, 2000);

        // Proactive polling every 15 seconds
        proactiveIntervalRef.current = setInterval(() => {
          if (!loadingRef.current && latestFrameRef.current) {
             const stealthPrompt = "Review the provided screen context. If you see a controversial claim, a strong political bias, or something highly notable/verifiable, explain it briefly. If the content is mundane, benign, or there is nothing of interest to report, reply with the exact text 'NONE' and nothing else.";
             submitGenerateRequest(stealthPrompt, null, true);
          }
        }, 15000);

        setIsScreenPolling(true);

        stream.getVideoTracks()[0].onended = () => {
           stopScreenPoll();
        };
      }
    } catch(err) {
      console.error(err);
      setError('Failed to share screen.');
    }
  };

  const stopScreenPoll = () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (proactiveIntervalRef.current) clearInterval(proactiveIntervalRef.current);
    setIsScreenPolling(false);
    if (videoRef.current && videoRef.current.srcObject) {
       (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
    setLatestFrame(null);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
            const base64Data = (reader.result as string).split(',')[1];
            submitGenerateRequest('[Voice Audio Message]', base64Data);
        };
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      setError('Failed to access microphone.');
    }
  };

  const submitGenerateRequest = async (textInput: string, audioBase64: string | null, isAutoPoll: boolean = false) => {
    const keyToUse = apiKeyRef.current;
    if (!keyToUse) {
      if (!isAutoPoll) setError('Please enter your Gemini API Key in the settings.');
      return;
    }

    const frameToUse = isAutoPoll ? latestFrameRef.current : latestFrame;

    const partsArray: any[] = [];
    if (textInput.trim()) {
      partsArray.push({ text: textInput });
    }
    
    if (frameToUse) {
      partsArray.push({
        inlineData: { mimeType: 'image/jpeg', data: frameToUse }
      });
    }

    if (audioBase64) {
      partsArray.push({
        inlineData: { mimeType: 'audio/webm', data: audioBase64 }
      });
    }

    const displayText = textInput || (audioBase64 ? '[Voice Input Included]' : '');
    const newUserMsg: Message = { role: 'user', content: displayText };
    
    if (frameToUse) {
       newUserMsg.content += ' \n[Screen Snapshot Embedded]';
    }

    if (!isAutoPoll) {
      setMessages(prev => [...prev, newUserMsg]);
      setInput('');
      setLoading(true);
      setError(null);
    }

    try {
      const ai = new GoogleGenAI({ apiKey: keyToUse });
      
      let parsedTools: Tool[] | undefined = undefined;
      if (toolsJson.trim()) {
        try {
          parsedTools = JSON.parse(toolsJson);
        } catch (err) {
          throw new Error('Invalid JSON in Tools schema');
        }
      }

      // Convert local history (only sending text to save tokens out of scope)
      const historyContents = messagesRef.current.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));
      historyContents.push({ role: 'user', parts: partsArray });

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: historyContents,
        config: {
          systemInstruction: systemPrompt,
          temperature,
          tools: parsedTools,
        }
      });

      if (response.functionCalls && response.functionCalls.length > 0) {
         response.functionCalls.forEach((call) => {
           setMessages(prev => [...prev, {
             role: 'model',
             content: `Tool Call: ${call.name}`,
             isToolCall: true,
             toolCallConfig: call.args
           }]);
         });
      }

      if (response.text) {
         const out = response.text.trim();
         if (isAutoPoll && (out === 'NONE' || out === "'NONE'" || out === '"NONE"')) {
            // Silently ignore benign screens
         } else {
             setMessages(prev => [...prev, {
               role: 'model',
               content: isAutoPoll ? `⚠️ **Proactive Detection:**\n${out}` : out
             }]);
         }
      } else if (!isAutoPoll && (!response.functionCalls || response.functionCalls.length === 0)) {
         setMessages(prev => [...prev, {
           role: 'model',
           content: '(No text response from model)'
         }]);
      }

    } catch (err: any) {
      console.error(err);
      if (!isAutoPoll) setError(err.message || 'An error occurred calling the Gemini API');
    } finally {
      if (!isAutoPoll) setLoading(false);
    }
  };

  const handleSend = () => {
    if (!input.trim() && !latestFrame) return;
    submitGenerateRequest(input, null);
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-200 overflow-hidden">
      <video ref={videoRef} autoPlay playsInline muted style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '10px', height: '10px', opacity: 0 }}></video>
      <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>

      {/* LHS Configuration Panel */}
      <div className="w-1/3 bg-gray-900 border-r border-gray-800 p-6 flex flex-col space-y-5 overflow-y-auto">
        <h2 className="text-xl font-bold flex items-center gap-2 text-white">
          <Settings size={20} />
          Model Settings
        </h2>
        
        <div>
          <label className="block text-sm font-medium mb-1">Gemini API Key</label>
          <input 
            type="password" 
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 rounded p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="AI Studio API Key"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">System Prompt</label>
          <textarea 
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            className="w-full h-32 font-mono text-sm bg-gray-950 border border-gray-700 rounded p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex-1 flex flex-col">
           <label className="flex items-center gap-2 block text-sm font-medium mb-1 text-purple-400 mt-2">
              <ServerCog size={16} />
              Tool Integrations
           </label>
           <textarea 
            value={toolsJson}
            onChange={e => setToolsJson(e.target.value)}
            className="w-full h-full min-h-[250px] font-mono text-sm bg-gray-950 border border-purple-900/50 rounded p-2 focus:ring-2 focus:ring-purple-500 focus:outline-none text-purple-200"
          />
        </div>
      </div>

      {/* RHS Chat Workspace */}
      <div className="flex-1 flex flex-col relative">
        <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Play size={18} className="text-blue-400"/>
            Playground Output
          </h1>
          
          <div className="flex items-center gap-3">
             {error && <div className="text-red-400 text-sm flex items-center gap-1 mr-4"><ShieldAlert size={14}/> {error}</div>}
             
             {isScreenPolling && latestFrame && (
                <div className="flex items-center gap-2 bg-gray-950 px-2 py-1 rounded border border-gray-700 relative overflow-hidden">
                   <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse z-10 absolute top-2 right-2"></div>
                   <img src={`data:image/jpeg;base64,${latestFrame}`} className="h-8 object-cover rounded opacity-80" alt="Live PIP" />
                   <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Live Polling</span>
                </div>
             )}

             <button 
                onClick={isScreenPolling ? stopScreenPoll : startScreenPoll}
                className={`py-1.5 px-3 rounded text-sm font-bold flex items-center gap-2 transition-colors ${isScreenPolling ? 'bg-red-900/50 text-red-400 hover:bg-red-800/80' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
             >
                {isScreenPolling ? <VideoOff size={16}/> : <Monitor size={16}/>}
                {isScreenPolling ? 'Stop Tracking' : 'Live Screen'}
             </button>
          </div>
        </div>
        
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {messages.length === 0 && (
             <div className="text-gray-500 h-full flex flex-col items-center justify-center italic text-center">
               <p>Send a message to start interacting.</p>
               <p className="mt-2 text-sm max-w-sm">Enable <Monitor size={14} className="inline"/> <b>Live Screen</b> to proactively let context enter the model on every prompt!</p>
             </div>
          )}
          {messages.map((m, i) => (
             <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[80%] rounded-lg p-3 ${
                  m.role === 'user' 
                    ? 'bg-blue-600 text-white' 
                    : m.isToolCall 
                      ? 'bg-purple-900/40 border border-purple-700/50 font-mono text-sm text-purple-300'
                      : 'bg-gray-800 border border-gray-700 text-gray-200'
                }`}>
                  {m.isToolCall && <strong className="block mb-1 text-purple-400">Function Called: {m.content.replace('Tool Call: ', '')}</strong>}
                  {!m.isToolCall && <div className="whitespace-pre-wrap">{m.content}</div>}
                  {m.isToolCall && m.toolCallConfig && (
                    <pre className="mt-2 bg-gray-950/50 p-2 rounded text-xs select-all">
                      {JSON.stringify(m.toolCallConfig, null, 2)}
                    </pre>
                  )}
                </div>
             </div>
          ))}
          {loading && (
             <div className="flex items-start">
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-gray-400 flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-100"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-200"></div>
                </div>
             </div>
          )}
        </div>

        <div className="p-4 bg-gray-900 border-t border-gray-800">
           <div className="flex gap-2">
             <button 
               onClick={toggleRecording}
               className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                 isRecording ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
               }`}
             >
                {isRecording ? <StopCircle size={18} /> : <Mic size={18} />}
             </button>

             <input
               value={input}
               onChange={e => setInput(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && handleSend()}
               placeholder="Chat or submit a claim to verify..."
               className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-600"
             />
             <button 
               onClick={handleSend}
               disabled={loading || (!input.trim() && !latestFrame && !isRecording)}
               className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
             >
                <Send size={18} />
             </button>
           </div>
        </div>
      </div>
    </div>
  );
}
