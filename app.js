import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

const MODEL = "onnx-community/whisper-base";
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

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = "status" + (kind ? " " + kind : "");
}
function setProgress(v) {
  bar.style.width = Math.max(0, Math.min(100, v)) + "%";
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
  setStatus("音声認識モデルを準備しています。初回だけ時間がかかります。");
  const make = async function(device) {
    return await pipeline("automatic-speech-recognition", MODEL, {
      device: device,
      dtype: device === "webgpu" ? "fp16" : "q8",
      progress_callback: function(p) {
        if (p && p.status === "progress" && typeof p.progress === "number") {
          setProgress(p.progress * 0.28);
          setStatus("モデルを準備中… " + Math.round(p.progress) + "%");
        } else if (p && p.status === "ready") {
          setProgress(28);
          setStatus("モデル準備完了（" + (device === "webgpu" ? "GPU" : "CPU") + "）");
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
  setStatus("音声を読み込んでいます…");
  const ctx = new AudioContext();
  const raw = await file.arrayBuffer();
  const audio = await ctx.decodeAudioData(raw);
  const channels = audio.numberOfChannels;
  const sourceLength = audio.length;
  const targetRate = 16000;
  const targetLength = Math.floor(sourceLength * targetRate / audio.sampleRate);
  const mono = new Float32Array(targetLength);
  const data = Array.from({length: channels}, function(_, c) { return audio.getChannelData(c); });
  const ratio = audio.sampleRate / targetRate;

  for (let i = 0; i < targetLength; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const a = data[c][j] || 0;
      const b = data[c][j + 1] !== undefined ? data[c][j + 1] : a;
      sum += a + (b-a) * frac;
    }
    mono[i] = sum / channels;
  }
  await ctx.close();
  return {mono: mono, duration: audio.duration};
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
    const chunkLength = 30;
    const stride = 5;
    const step = chunkLength - stride;
    const totalChunks = Math.max(1, Math.ceil(Math.max(0, duration - stride) / step));
    let doneChunks = 0;

    setStatus("文字起こし中… 0 / " + totalChunks + " 区間（約 " + Math.floor(duration/60) + "分 " + Math.round(duration%60) + "秒）");
    setProgress(30);

    const res = await pipe(audio.mono, {
      chunk_length_s: chunkLength,
      stride_length_s: stride,
      return_timestamps: true,
      language: "japanese",
      task: "transcribe",
      chunk_callback: function(chunk) {
        doneChunks += 1;
        const pct = 30 + Math.min(69, (doneChunks / totalChunks) * 69);
        setProgress(pct);
        setStatus("文字起こし中… " + Math.min(doneChunks, totalChunks) + " / " + totalChunks + " 区間");
      }
    });
    const raw = normalize(res.text || "");
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
    setStatus("完了。仕上 " + groups.finish.length + "件 ／ ショット " + groups.shot.length + "件 ／ 未分類 " + groups.unknown.length + "件", "ok");
  } catch (err) {
    console.error(err);
    setStatus("処理に失敗しました：" + (err && err.message ? err.message : err), "error");
    setProgress(0);
  } finally {
    runBtn.disabled = false;
  }
});
