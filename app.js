import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

const MODEL = "onnx-community/whisper-large-v3-turbo";
let transcriber = null;
let outputs = { all:"", finish:"", shot:"", unknown:"", raw:"" };
let currentTab = "all";
let lastGroups = {finish:[], shot:[], unknown:[]};
let lastRaw = "";

const $ = (id) => document.getElementById(id);
const fileInput = $("audioFile");
const runBtn = $("runBtn");
const statusEl = $("status");
const bar = $("bar");
const results = $("results");
const out = $("out");
let transcriptionTimer = null;
let transcriptionStartedAt = 0;
let transcriptionDuration = 0;

function startEstimatedProgress(duration) {
  transcriptionStartedAt = Date.now();
  transcriptionDuration = duration;
  clearInterval(transcriptionTimer);

  // Standard Whisper chunking uses 30s chunks with a 5s stride.
  const step = 25;
  const totalChunks = Math.max(1, Math.ceil(Math.max(0, duration - 5) / step));

  transcriptionTimer = setInterval(function() {
    const elapsed = (Date.now() - transcriptionStartedAt) / 1000;
    // Show a conservative estimated completion based on observed processing time.
    // The bar is intentionally capped below 90% until inference actually finishes.
    const estimatedSecondsPerChunk = Math.max(8, elapsed / Math.max(1, Math.min(3, elapsed / 12)));
    const estimatedDone = Math.min(totalChunks - 1, Math.max(0, Math.floor(elapsed / estimatedSecondsPerChunk)));
    const pct = Math.min(88, 30 + (estimatedDone / totalChunks) * 58);

    setProgress(pct);
    setStatus("③ 文字起こし中…（推定 " + estimatedDone + " / " + totalChunks + " 区間）");
  }, 1000);
}
function stopEstimatedProgress() {
  clearInterval(transcriptionTimer);
  transcriptionTimer = null;
}


function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = "status" + (kind ? " " + kind : "");
}
function setProgress(v) {
  bar.classList.remove("processing");
  bar.style.width = Math.max(0, Math.min(100, v)) + "%";
}
function setProcessing(active) {
  if (active) {
    bar.style.width = "45%";
    bar.classList.add("processing");
  } else {
    bar.classList.remove("processing");
  }
}

function fmtBytes(n) {
  return n < 1024*1024 ? (n/1024).toFixed(0) + " KB" : (n/1024/1024).toFixed(1) + " MB";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c];
  });
}

fileInput.addEventListener("change", function() {
  const f = fileInput.files && fileInput.files[0];
  runBtn.disabled = !f;
  if (f) {
    $("fileInfo").textContent = f.name + " ／ " + fmtBytes(f.size);
    setStatus("準備OK。資料化を押してください。");
  } else {
    $("fileInfo").textContent = "まだ音声ファイルが選択されていません。";
    setStatus("待機中です。");
  }
});

async function getTranscriber() {
  if (transcriber) return transcriber;
  const webgpu = !!navigator.gpu;
  setStatus("① 音声認識モデルを準備しています。初回だけ時間がかかります。");
  const make = async function(device) {
    return await pipeline("automatic-speech-recognition", MODEL, {
      device: device,
      dtype: device === "webgpu" ? "q4f16" : "q8",
      progress_callback: function(p) {
        if (p && p.status === "progress" && typeof p.progress === "number") {
          setProgress(p.progress * 0.28);
          setStatus("① モデルを準備中… " + Math.round(p.progress) + "%");
        } else if (p && p.status === "ready") {
          setProgress(28);
          setStatus("① モデル準備完了（" + (device === "webgpu" ? "GPU" : "CPU") + "）");
        }
      }
    });
  };
  try {
    transcriber = await make(webgpu ? "webgpu" : "wasm");
    return transcriber;
  } catch (e) {
    if (webgpu) {
      setStatus("GPUで起動できなかったため、CPUモードに切り替えます…");
      transcriber = await make("wasm");
      return transcriber;
    }
    throw e;
  }
}

async function decodeTo16k(file) {
  setStatus("② 音声を読み込んでいます…");
  const raw = await file.arrayBuffer();
  const sourceCtx = new AudioContext();
  const audio = await sourceCtx.decodeAudioData(raw);
  await sourceCtx.close();

  const targetRate = 16000;
  const targetLength = Math.max(1, Math.ceil(audio.duration * targetRate));
  const offline = new OfflineAudioContext(1, targetLength, targetRate);
  const buffer = offline.createBuffer(audio.numberOfChannels, audio.length, audio.sampleRate);

  for (let c = 0; c < audio.numberOfChannels; c++) {
    buffer.copyToChannel(audio.getChannelData(c), c);
  }

  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);

  const rendered = await offline.startRendering();
  return {
    mono: rendered.getChannelData(0),
    duration: audio.duration
  };
}

function normalize(s) {
  return s.replace(/\s+/g, " ").replace(/\s*([、。！？])\s*/g, "$1").trim();
}
function splitSentences(text) {
  const t = normalize(text);
  const parts = t.split(/(?<=[。！？])\s*|\n+/).map(function(x){return x.trim();}).filter(Boolean);
  return parts.length ? parts : [t];
}
function parseKeywords(raw) {
  return raw.split(/[、,，\n]/).map(function(x){return x.trim();}).filter(Boolean).sort(function(a,b){return b.length-a.length;});
}
function classify(sentences, finishKeys, shotKeys) {
  let current = "unknown";
  const groups = {finish:[], shot:[], unknown:[]};
  for (const sentence of sentences) {
    const f = finishKeys.some(function(k){return sentence.includes(k);});
    const s = shotKeys.some(function(k){return sentence.includes(k);});
    if (f && !s) current = "finish";
    else if (s && !f) current = "shot";
    else if (f && s) {
      const fk = finishKeys.find(function(k){return sentence.includes(k);});
      const sk = shotKeys.find(function(k){return sentence.includes(k);});
      current = sentence.indexOf(fk) <= sentence.indexOf(sk) ? "finish" : "shot";
    }
    groups[current].push(sentence);
  }
  return groups;
}
function joinLines(list, prefix) {
  return list.length ? list.map(function(x){return prefix + x;}).join("\n") : prefix + "内容なし";
}
function buildText(groups, raw) {
  return "【仕上】\n" + joinLines(groups.finish, "・") +
    "\n\n【ショット】\n" + joinLines(groups.shot, "・") +
    "\n\n【未分類】\n" + joinLines(groups.unknown, "・") +
    "\n\n【文字起こし全文】\n" + raw;
}
function buildMarkdown(groups, raw) {
  return "# 音声資料化\n\n## 仕上\n" + joinLines(groups.finish, "- ") +
    "\n\n## ショット\n" + joinLines(groups.shot, "- ") +
    "\n\n## 未分類\n" + joinLines(groups.unknown, "- ") +
    "\n\n## 文字起こし全文\n\n" + raw;
}
function buildDoc(text) {
  const html = text.split("\n").map(function(x){return x ? "<p>" + escapeHtml(x) + "</p>" : "<br>";}).join("");
  return "<!doctype html><html><head><meta charset='utf-8'><title>音声資料</title></head><body>" + html + "</body></html>";
}
function download(name, content, type) {
  const blob = new Blob([content], {type:type});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){URL.revokeObjectURL(a.href);}, 1000);
}
function render() {
  out.textContent = outputs[currentTab] || "";
}

document.querySelectorAll(".tab").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".tab").forEach(function(x){x.classList.remove("active");});
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    render();
  });
});

$("txtBtn").addEventListener("click", function(){download("audio_material.txt", outputs.all, "text/plain;charset=utf-8");});
$("mdBtn").addEventListener("click", function(){download("audio_material.md", buildMarkdown(lastGroups,lastRaw), "text/markdown;charset=utf-8");});
$("docBtn").addEventListener("click", function(){download("audio_material.doc", buildDoc(buildText(lastGroups,lastRaw)), "application/msword");});

runBtn.addEventListener("click", async function() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  runBtn.disabled = true;
  results.style.display = "none";
  setProgress(0);
  try {
    const pipe = await getTranscriber();
    const audio = await decodeTo16k(file);
    const duration = audio.duration;
    setStatus("③ 文字起こしを開始します（推定 " + Math.max(1, Math.ceil(Math.max(0, duration - 5) / 25)) + " 区間）");
    setProgress(30);
    setProcessing(true);
    startEstimatedProgress(duration);

    const res = await pipe(audio.mono, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      language: "japanese",
      task: "transcribe"
    });

    stopEstimatedProgress();
    setProcessing(false);
    setProgress(92);
    stopEstimatedProgress();
    setProcessing(false);
    setProgress(92);
    setStatus("④ 文字起こし完了。資料化しています…");
    const raw = normalize(res.text || "");
    const chars = raw.replace(/\s/g, "");
    const repeated = chars.length >= 80
      ? Math.max(...Array.from(new Set(chars)).map(function(ch){ return chars.split(ch).length - 1; })) / chars.length
      : 0;
    if (!raw || repeated > 0.65) {
      throw new Error("文字起こし結果が不自然です。音声を正しく認識できていない可能性があります。");
    }
    lastRaw = raw;
    const groups = classify(
      splitSentences(raw),
      parseKeywords($("kwFinish").value),
      parseKeywords($("kwShot").value)
    );
    lastGroups = groups;
    outputs.raw = raw;
    outputs.finish = groups.finish.length ? groups.finish.join("\n") : "（該当内容なし）";
    outputs.shot = groups.shot.length ? groups.shot.join("\n") : "（該当内容なし）";
    outputs.unknown = groups.unknown.length ? groups.unknown.join("\n") : "（該当内容なし）";
    outputs.all = buildText(groups, raw);
    render();
    results.style.display = "block";
    setProgress(100);
    setStatus("⑤ 完了。仕上 " + groups.finish.length + "件 ／ ショット " + groups.shot.length + "件 ／ 未分類 " + groups.unknown.length + "件", "ok");
  } catch (err) {
    stopEstimatedProgress();
    setProcessing(false);
    console.error(err);
    setStatus("処理に失敗しました：" + (err && err.message ? err.message : err), "error");
    setProgress(0);
  } finally {
    stopEstimatedProgress();
    setProcessing(false);
    runBtn.disabled = false;
  }
});
