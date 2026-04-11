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
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [toolsJson, setToolsJson] = useState(DEFAULT_TOOLS);
  const [temperature, setTemperature] = useState<number>(0.7);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isScreenPolling, setIsScreenPolling] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string>('Disconnected');
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  
  const messagesRef = useRef<Message[]>([]);
  const latestFrameRef = useRef<string | null>(null);
  const apiKeyRef = useRef<string>('');
  const loadingRef = useRef<boolean>(false);
  const isLiveConnectedRef = useRef<boolean>(false);

  React.useEffect(() => { 
    messagesRef.current = messages; 
  }, [messages]);
  React.useEffect(() => { latestFrameRef.current = latestFrame; }, [latestFrame]);
  React.useEffect(() => { 
    apiKeyRef.current = apiKey; 
    localStorage.setItem('gemini_api_key', apiKey);
  }, [apiKey]);
  React.useEffect(() => { loadingRef.current = loading; }, [loading]);
  React.useEffect(() => { isLiveConnectedRef.current = isLiveConnected; }, [isLiveConnected]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollingIntervalRef = useRef<any>(null);

  const startScreenPoll = async () => {
    const keyToUse = apiKeyRef.current;
    if (!keyToUse) {
      setError('Please enter your Gemini API Key in the settings first.');
      return;
    }

    try {
      setLiveStatus('Connecting...');
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 }
      });
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      // Initialize Live Session - Explicitly use v1alpha for Live API
      const ai = new GoogleGenAI({ 
        apiKey: keyToUse,
        apiVersion: 'v1alpha'
      });
      
      const session = await ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          systemInstruction: {
            parts: [{ text: "You are a proactive social media copilot. You are viewing a live stream of the user's screen. Your goal is to identify controversial claims, political bias, or notable news items. Only interrupt and speak if you find something truly interesting or worth verifying. Be concise." }]
          },
          responseModalities: ["TEXT"]
        },
        callbacks: {
          onopen: () => {
             console.log('Live Session Connected');
             setIsLiveConnected(true);
             setLiveStatus('Connected');
             
             const initialPrompt = "I've started the live screen share. Please monitor my screen and alert me if you see anything interesting, controversial, or news-worthy. Acknowledge this with a brief 'Monitoring active' and then narrate briefly what you see on my screen right now to confirm you can see it.";
             
             // Show in UI
             setMessages(prev => [...prev, { role: 'user', content: initialPrompt }]);

             // Send initial greeting to confirm session is active
             session.sendClientContent({
               turns: [{ role: 'user', parts: [{ text: initialPrompt }] }],
               turnComplete: true
             });
          },
          onmessage: (msg: any) => {
            console.log('Live Message Received:', msg);
            if (msg.serverContent?.modelTurn?.parts) {
              const text = msg.serverContent.modelTurn.parts
                .map((p: any) => p.text)
                .filter(Boolean)
                .join('');
              if (text) {
                setMessages(prev => [...prev, {
                  role: 'model',
                  content: `🔴 **Live Detection:**\n${text}`
                }]);
              }
            }
          },
          onerror: (e) => {
             console.error('Live Error:', e);
             setLiveStatus('Error');
          },
          onclose: () => {
             console.log('Live Session Closed');
             setIsLiveConnected(false);
             setLiveStatus('Disconnected');
             sessionRef.current = null;
          }
        }
      });
      sessionRef.current = session;

      // Start continuous frame streaming (approx 1fps)
      pollingIntervalRef.current = setInterval(() => {
        if (videoRef.current && canvasRef.current && sessionRef.current && isLiveConnectedRef.current) {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0);
              const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
              latestFrameRef.current = base64;
              setLatestFrame(base64);
              setFrameCount(prev => prev + 1);
              
              // Send to Live API
              console.log(`Sending frame to Live API (${base64.length} bytes)`);
              sessionRef.current.sendRealtimeInput({
                video: {
                  mimeType: 'image/jpeg',
                  data: base64
                }
              });
            }
        }
      }, 1000);

      setIsScreenPolling(true);
      mediaStream.getVideoTracks()[0].onended = () => {
         stopScreenPoll();
      };
    } catch (err: any) {
      console.error(err);
      setError('Could not start screen share or Live API connection');
    }
  };

  const stopScreenPoll = () => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }
    setIsLiveConnected(false);
    setLiveStatus('Disconnected');
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
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
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 text-[10px] font-bold uppercase tracking-widest">
                   <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                   Live Context Active
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

        {/* New Live Context View Area */}
        {isScreenPolling && (
          <div className="p-4 bg-gray-900/80 border-b border-gray-800 flex gap-4">
             <div className="w-64 aspect-video bg-black rounded border border-gray-700 relative overflow-hidden flex items-center justify-center">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="w-full h-full object-contain"
                />
                {!latestFrame && <div className="text-gray-600 text-[10px]">Initializing Stream...</div>}
                <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-[8px] font-mono text-gray-400">
                  SECURE LIVE FEED | {frameCount} FRAMES
                </div>
             </div>
             <div className="flex-1 space-y-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Active Screen Perspective</div>
                <div className="text-sm text-gray-300 line-clamp-2 italic">
                  "Watching for interesting, controversial, or news-worthy content..."
                </div>
                <div className="flex gap-2">
                   <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px] border border-green-800/50">LOOP_ACTIVE</span>
                   <span className="px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded text-[10px] border border-blue-800/50">1 frame/sec</span>
                </div>
             </div>
          </div>
        )}
        
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {messages.length === 0 && (
             <div className="text-gray-500 h-full flex flex-col items-center justify-center italic text-center">
               {isScreenPolling ? (
                 <>
                   <div className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 animate-pulse">
                     <Monitor size={24} className="text-blue-400"/>
                   </div>
                   <p className="font-semibold text-gray-300">Live Monitoring Active</p>
                   <p className="mt-2 text-sm max-w-sm">I am watching your screen. I will speak up automatically if I detect something notable or news-worthy.</p>
                 </>
               ) : (
                 <>
                   <p>Send a message to start interacting.</p>
                   <p className="mt-2 text-sm max-w-sm">Enable <Monitor size={14} className="inline"/> <b>Live Screen</b> to proactively let context enter the model on every prompt!</p>
                 </>
               )}
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
