import { GoogleGenAI } from '@google/genai';

async function run() {
  const ai = new GoogleGenAI({ apiKey: 'test' });
  try {
     const session = await ai.live.connect({ model: 'gemini-2.0-flash-exp' });
     console.log('has asyncIterator?', typeof session[Symbol.asyncIterator]);
     console.log('has on?', typeof session.on);
     console.log('has addEventListener?', typeof session.addEventListener);
  } catch (e) {
     console.log('error', e.message);
  }
}
run();
