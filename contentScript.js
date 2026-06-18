(() => {
  "use strict";

  const DOWNLOAD_BUTTON_ID = "float-download-btn";
  const TRANSCRIBE_BUTTON_ID = "float-transcribe-btn";

  function uniqueHttpUrls(values) {
    return [...new Set(values)].filter((url) => /^https?:\/\//i.test(url));
  }

  function getImageUrls(container) {
    return uniqueHttpUrls(
      [...container.querySelectorAll(".media-container img, img")]
        .map((image) => image.currentSrc || image.src)
        .filter(Boolean)
    );
  }

  function getVideoUrls(container) {
    const urls = [];

    for (const video of container.querySelectorAll("video")) {
      urls.push(video.currentSrc, video.src);
      for (const source of video.querySelectorAll("source")) {
        urls.push(source.src);
      }
    }

    for (const entry of performance.getEntriesByType("resource")) {
      const url = entry.name || "";
      if (
        /xhscdn\.(com|com\.cn)/i.test(url) &&
        (/sns-video/i.test(url) || /\.(mp4|webm|m3u8)(?:$|[?#])/i.test(url))
      ) {
        urls.push(url);
      }
    }

    return uniqueHttpUrls(urls);
  }

  function textFrom(container, selector) {
    return [...container.querySelectorAll(selector)]
      .map((node) => node.innerText?.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function getTextContent(container) {
    return {
      auth:
        textFrom(container, ".author-wrapper .username, .author-container .username") ||
        "小红书笔记",
      note: textFrom(container, ".note-content .desc, #detail-desc, .desc"),
      comments: textFrom(container, ".comments-container .parent-comment")
    };
  }

  function setButtonState(button, label, disabled) {
    button.textContent = label;
    button.disabled = disabled;
  }

  function setAllButtonsDisabled(disabled) {
    for (const id of [DOWNLOAD_BUTTON_ID, TRANSCRIBE_BUTTON_ID]) {
      const button = document.getElementById(id);
      if (button) {
        button.disabled = disabled;
      }
    }
  }

  function downloadNote(button, transcribe) {
    const container = document.getElementById("noteContainer");
    if (!container) {
      setButtonState(button, "未找到笔记", false);
      return;
    }

    setAllButtonsDisabled(true);
    setButtonState(button, transcribe ? "转录中..." : "下载中...", true);
    chrome.runtime.sendMessage(
      {
        action: "createZip",
        imageUrls: getImageUrls(container),
        videoUrls: getVideoUrls(container),
        textContent: getTextContent(container),
        transcribe
      },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          console.error("下载失败:", chrome.runtime.lastError || response?.message);
          setButtonState(button, response?.message || "下载失败", false);
          setAllButtonsDisabled(false);
          return;
        }

        const suffix = response.warning ? "（部分资源失败）" : "";
        setButtonState(button, `下载完成${suffix}`, false);
        setAllButtonsDisabled(false);
        setTimeout(
          () => setButtonState(button, transcribe ? "下载+转录" : "下载笔记", false),
          2500
        );
      }
    );
  }

  function ensureButton() {
    const container = document.getElementById("noteContainer");
    const downloadButton = document.getElementById(DOWNLOAD_BUTTON_ID);
    const transcribeButton = document.getElementById(TRANSCRIBE_BUTTON_ID);

    if (!container) {
      downloadButton?.remove();
      transcribeButton?.remove();
      return;
    }

    if (!downloadButton) {
      const button = document.createElement("button");
      button.id = DOWNLOAD_BUTTON_ID;
      button.textContent = "下载笔记";
      button.addEventListener("click", () => downloadNote(button, false));
      document.body.appendChild(button);
    }

    if (!transcribeButton) {
      const button = document.createElement("button");
      button.id = TRANSCRIBE_BUTTON_ID;
      button.textContent = "下载+转录";
      button.addEventListener("click", () => downloadNote(button, true));
      document.body.appendChild(button);
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    #${DOWNLOAD_BUTTON_ID},
    #${TRANSCRIBE_BUTTON_ID} {
      position: fixed;
      right: 24px;
      z-index: 2147483647;
      padding: 10px 18px;
      border: 0;
      border-radius: 6px;
      color: #fff;
      background: #ff2442;
      box-shadow: 0 2px 10px rgba(0, 0, 0, .2);
      cursor: pointer;
    }
    #${DOWNLOAD_BUTTON_ID} {
      bottom: 40px;
    }
    #${TRANSCRIBE_BUTTON_ID} {
      bottom: 88px;
      background: #6b4eff;
    }
    #${DOWNLOAD_BUTTON_ID}:disabled,
    #${TRANSCRIBE_BUTTON_ID}:disabled {
      background: #999;
      cursor: wait;
    }
  `;
  document.head.appendChild(style);

  ensureButton();
  new MutationObserver(ensureButton).observe(document.body, {
    childList: true,
    subtree: true
  });
})();
