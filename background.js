"use strict";

importScripts("jszip.js");

function safeFilename(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function filenameFromUrl(url, fallback) {
  try {
    const lastPart = new URL(url).pathname.split("/").filter(Boolean).pop();
    return safeFilename(lastPart?.replace(/\.[^/.]+$/, ""), fallback);
  } catch {
    return fallback;
  }
}

function extensionFromType(contentType, url, fallback) {
  const type = (contentType || "").split(";")[0].toLowerCase();
  const extensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "application/vnd.apple.mpegurl": ".m3u8",
    "application/x-mpegurl": ".m3u8"
  };
  if (extensions[type]) {
    return extensions[type];
  }

  const match = new URL(url).pathname.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|m3u8)$/i);
  return match ? `.${match[1].toLowerCase()}` : fallback;
}

async function addResource(zip, folder, url, index, fallbackExtension) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("资源为空");
  }

  const extension = extensionFromType(
    response.headers.get("Content-Type"),
    url,
    fallbackExtension
  );
  const filename = filenameFromUrl(url, `${folder}-${index + 1}`);
  zip.file(`${folder}/${filename}${extension}`, blob);
  return { blob, filename: `${filename}${extension}` };
}

async function transcribeVideo(video) {
  const response = await fetch(
    `http://127.0.0.1:18765/transcribe?filename=${encodeURIComponent(video.filename)}`,
    {
      method: "POST",
      headers: { "Content-Type": video.blob.type || "application/octet-stream" },
      body: video.blob
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `转录服务 HTTP ${response.status}`);
  }
  return payload;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("ZIP 读取失败"));
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function createZip(request) {
  const zip = new JSZip();
  const text = request.textContent || {};
  zip.file("笔记内容.txt", text.note || "");
  zip.file("评论内容.txt", text.comments || "");

  const imageJobs = [];
  for (const [index, url] of (request.imageUrls || []).entries()) {
    imageJobs.push(addResource(zip, "images", url, index, ".jpg"));
  }
  const videoJobs = [];
  for (const [index, url] of (request.videoUrls || []).entries()) {
    videoJobs.push(addResource(zip, "videos", url, index, ".mp4"));
  }

  const imageResults = await Promise.allSettled(imageJobs);
  const videoResults = await Promise.allSettled(videoJobs);
  const results = [...imageResults, ...videoResults];
  const failures = results.filter((result) => result.status === "rejected");
  const successfulResources = results.length - failures.length;

  if ((request.videoUrls || []).length > 0 && successfulResources === 0) {
    throw new Error("检测到视频，但媒体资源全部下载失败");
  }

  let transcriptionFailure = null;
  if (request.transcribe) {
    const video = videoResults.find((result) => result.status === "fulfilled")?.value;
    if (!video) {
      transcriptionFailure = "没有可用于转录的视频";
    } else {
      try {
        const transcript = await transcribeVideo(video);
        zip.file("转录文字.txt", `${transcript.text || ""}\n`);
        zip.file("转录字幕.srt", transcript.srt || "");
        zip.file(
          "转录数据.json",
          `${JSON.stringify(
            {
              language: transcript.language,
              language_probability: transcript.language_probability,
              duration_seconds: transcript.duration_seconds,
              segments: transcript.segments || []
            },
            null,
            2
          )}\n`
        );
      } catch (error) {
        transcriptionFailure =
          error instanceof TypeError
            ? "无法连接本地转录服务，请先运行 start-transcription-service.ps1"
            : error.message;
        zip.file("转录失败.txt", `${transcriptionFailure}\n`);
      }
    }
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  const dataUrl = await blobToDataUrl(blob);
  const filename = `${safeFilename(text.auth, "小红书笔记")}.zip`;

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true
  });

  return {
    success: true,
    warning: failures.length > 0 || Boolean(transcriptionFailure),
    failedResources: failures.length,
    transcriptionFailure
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action !== "createZip") {
    return false;
  }

  createZip(request)
    .then(sendResponse)
    .catch((error) => {
      console.error("创建 ZIP 失败:", error);
      sendResponse({
        success: false,
        message: error?.message || "创建 ZIP 失败"
      });
    });
  return true;
});
