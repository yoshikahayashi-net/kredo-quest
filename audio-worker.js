import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

const MODEL = "onnx-community/whisper-large-v3-turbo";
let transcriber = null;

function send(type, payload) {
  self.postMessage(Object.assign({ type }, payload || {}));
}

function normalize(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/\s*([、。！？])\s*/g, "$1").trim();
}

async function getTranscriber() {
  if (transcriber) return transcriber;

  const webgpu = !!(self.navigator && self.navigator.gpu);
  const make = async (device) => {
    return await pipeline("automatic-speech-recognition", MODEL, {
      device,
      dtype: device === "webgpu" ? "q4f16" : "q8",
      progress_callback: function(p) {
        if (!p) return;
        if (p.status === "progress" && typeof p.progress === "number") {
          send("model-progress", { progress: p.progress, device });
        } else if (p.status === "ready") {
          send("model-ready", { device });
        }
      }
    });
  };

  try {
    transcriber = await make(webgpu ? "webgpu" : "wasm");
    return transcriber;
  } catch (e) {
    if (webgpu) {
      send("model-fallback", { message: "GPUで起動できなかったため、CPUモードに切り替えます…" });
      transcriber = await make("wasm");
      return transcriber;
    }
    throw e;
  }
}

self.onmessage = async function(event) {
  const data = event.data || {};
  if (data.type !== "transcribe") return;

  try {
    send("status", { message: "① 音声認識モデルを準備しています。初回だけ時間がかかります。" });
    const pipe = await getTranscriber();

    const sampleRate = data.sampleRate || 16000;
    const audio = new Float32Array(data.audio);
    const chunkSeconds = 30;
    const overlapSeconds = 3;
    const chunkSamples = chunkSeconds * sampleRate;
    const overlapSamples = overlapSeconds * sampleRate;
    const stepSamples = chunkSamples - overlapSamples;
    const totalChunks = Math.max(
      1,
      Math.ceil(Math.max(0, audio.length - overlapSamples) / stepSamples)
    );

    const segments = [];

    for (let i = 0; i < totalChunks; i++) {
      const startSample = i * stepSamples;
      const endSample = Math.min(audio.length, startSample + chunkSamples);
      const chunk = audio.slice(startSample, endSample);

      send("chunk-start", {
        done: i,
        total: totalChunks,
        start: startSample / sampleRate,
        end: endSample / sampleRate
      });

      const part = await pipe(chunk, {
        return_timestamps: false,
        language: "japanese",
        task: "transcribe"
      });

      const text = normalize(part && part.text ? part.text : "");
      if (text) {
        segments.push({
          start: startSample / sampleRate,
          end: endSample / sampleRate,
          text
        });
      }

      send("chunk-done", {
        done: i + 1,
        total: totalChunks,
        start: startSample / sampleRate,
        end: endSample / sampleRate
      });
    }

    send("complete", { segments });
  } catch (error) {
    send("error", {
      message: error && error.message ? error.message : String(error)
    });
  }
};
