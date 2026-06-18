# 小红书笔记下载器（视频转录版）

一个 Chrome 扩展（Manifest V3），在用户主动操作后，下载当前小红书笔记的**正文、评论、图片和视频**，并可选调用**本机 Whisper 服务**生成视频转录的 TXT / SRT / JSON 文件，最终打包为一个 ZIP 下载。

> ⚠️ **使用前提**：本工具仅用于下载你**有权使用**的内容。请遵守小红书的用户协议与相关法律法规，勿用于批量抓取、绕过访问限制或侵犯版权。数据默认全部留在本机，不上传任何云端服务。

---

## ✨ 功能特性

- **一键下载笔记**：抓取当前笔记的正文、评论、图片、视频，打包为 ZIP。
- **可选本地转录**：调用本机 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 服务，将视频音频转写为：
  - `转录文字.txt`（纯文本）
  - `转录字幕.srt`（带时间轴字幕）
  - `转录数据.json`（含语言、时长、分段时间戳）
- **隐私优先**：转录服务仅监听 `127.0.0.1`，且只接受来自 `chrome-extension://` 的请求，数据不出本机。
- **容错下载**：部分资源失败时仍会完成其余内容的打包，并在按钮上提示「部分资源失败」。

---

## 🏗️ 架构

```
┌─────────────────────┐      sendMessage      ┌──────────────────────┐
│  contentScript.js   │ ───────────────────▶  │    background.js      │
│  注入下载按钮、       │                       │  (service worker)     │
│  抓取图片/视频/文本   │ ◀───────────────────  │  抓取资源 → 打包 ZIP   │
└─────────────────────┘      response         └──────────┬───────────┘
        在小红书页面运行                                    │ POST /transcribe
                                                          ▼
                                          ┌───────────────────────────────┐
                                          │  transcription_server.py       │
                                          │  127.0.0.1:18765 (本机)         │
                                          │  faster-whisper 转录             │
                                          └───────────────────────────────┘
```

| 文件 | 作用 |
|------|------|
| `manifest.json` | MV3 扩展清单 |
| `contentScript.js` | 注入浮动按钮、抓取页面图片/视频/文本 |
| `background.js` | Service worker：下载资源、打包 ZIP、调用转录服务、触发下载 |
| `jszip.js` | ZIP 打包库（[JSZip](https://stuk.github.io/jszip/)） |
| `popup.html` / `popup.css` | 扩展弹窗说明 |
| `transcription_server.py` | 本机转录 HTTP 服务（faster-whisper） |
| `start-transcription-service.ps1` | Windows 下启动转录服务的脚本 |
| `icons/` | 扩展图标 |

---

## 🚀 安装与部署

### 1. 加载扩展（开发者模式）

1. 打开 Chrome，访问 `chrome://extensions/`。
2. 右上角开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择本项目根目录。
4. 打开任意小红书笔记页（`https://www.xiaohongshu.com/...`），页面右下角会出现「下载笔记」和「下载+转录」按钮。

> 仅需「下载笔记」（不转录）时，可跳过下面的转录服务步骤。

### 2. 部署本机转录服务（仅「下载+转录」需要）

转录依赖 Python 与 `faster-whisper`。

**环境要求**
- Python 3.9+
- [FFmpeg](https://ffmpeg.org/)（faster-whisper 解码音视频所需，需在 PATH 中）
- 首次运行会自动下载 Whisper `small` 模型（约数百 MB）

**安装依赖**

```bash
# 在项目上级目录创建虚拟环境（启动脚本默认查找 ../.whisper-env）
python -m venv .whisper-env

# 激活
# Windows (PowerShell):
.whisper-env\Scripts\Activate.ps1
# macOS / Linux:
source .whisper-env/bin/activate

pip install -r requirements.txt
```

**启动服务**

- Windows：
  ```powershell
  ./start-transcription-service.ps1
  ```
  脚本会在后台启动服务并写日志到 `transcription-service.log`。

- 手动启动（任意平台）：
  ```bash
  python transcription_server.py
  ```
  看到 `XHS transcription service listening on http://127.0.0.1:18765` 即成功。

**健康检查**
```bash
curl http://127.0.0.1:18765/health
# {"ok": true, "model": "small"}
```

---

## 📖 使用

1. 打开一篇小红书笔记。
2. 点击右下角按钮：
   - **下载笔记**：仅打包文本 + 图片 + 视频。
   - **下载+转录**：在上面的基础上，把视频送本机转录服务，额外生成 TXT/SRT/JSON。
3. 浏览器弹出保存对话框，ZIP 文件名取自笔记作者名。

ZIP 内目录结构示例：
```
某作者.zip
├── 笔记内容.txt
├── 评论内容.txt
├── images/
│   ├── xxxx.jpg
│   └── ...
├── videos/
│   └── xxxx.mp4
├── 转录文字.txt      （仅「下载+转录」）
├── 转录字幕.srt      （仅「下载+转录」）
└── 转录数据.json     （仅「下载+转录」）
```

---

## ⚙️ 配置

| 项 | 位置 | 默认值 |
|----|------|--------|
| 转录服务端口 | `transcription_server.py` `PORT` | `18765` |
| 最大上传大小 | `transcription_server.py` `MAX_UPLOAD_BYTES` | 500 MB |
| Whisper 模型 | `transcription_server.py` `get_model()` | `small` / CPU / int8 |

> 修改端口后，需同步更新 `manifest.json` 的 `host_permissions` 和 `background.js` 中的转录 URL。

---

## ✅ 待办项（Roadmap）

- [ ] **m3u8 视频处理**：当前直接保存/转录 `.m3u8` 链接，但它只是播放列表文本而非视频本体，会导致这类视频保存无效、转录失败。需在服务端用 FFmpeg 拉取并合并分片后再转录。
- [ ] **转录超时与进度反馈**：长视频在 CPU `small` 模型下可能耗时数分钟，需增加超时、进度提示，并防止 service worker 被回收导致响应丢失。
- [ ] **模型可配置**：通过 popup 或环境变量切换模型大小（`tiny`/`base`/`small`/`medium`）与设备（CPU/GPU）。
- [ ] **DOM 选择器兜底**：小红书改版会使 `.note-content .desc`、`.author-wrapper` 等选择器失效，需增加兜底与失败提示。
- [ ] **跨平台启动脚本**：补充 macOS / Linux 的启动脚本（目前仅有 PowerShell 版）。
- [ ] **多笔记/批量场景的产品边界确认**（当前刻意只支持单篇，符合上架原则）。
- [ ] **Chrome Web Store 上架**：参见 `WEB_STORE_IMPLEMENTATION_PLAN.md` 与 `BROWSER_EXTENSION_WEB_STORE_PLAN.md`。
- [ ] **国际化 / 英文文档**：补充 README 英文版。

---

## 🐞 已知问题

- **m3u8 流式视频**：见待办项第 1 条，目前无法正确下载/转录。
- **页面结构依赖**：抓取依赖小红书当前的 DOM 结构，平台改版后可能静默失效。
- **首次转录较慢**：首次调用会下载并加载 Whisper 模型，需耐心等待。
- **服务未启动时**：未启动本机服务直接点「下载+转录」，ZIP 中会生成 `转录失败.txt` 说明原因，其余内容仍可正常下载。

---

## 🔒 隐私与安全

- 扩展权限最小化：仅申请 `downloads` 及小红书/CDN/本机转录服务的 `host_permissions`。
- 转录服务仅绑定 `127.0.0.1`，并校验请求来源为 `chrome-extension://`。
- 不读取登录凭据、Cookie 或浏览器存储；不上传任何数据到云端。
- 上传大小受限（默认 500 MB），临时文件转录后立即删除。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。建议：

1. Fork 本仓库并新建分支。
2. 保持现有代码风格（无构建步骤，原生 JS / Python）。
3. 改动转录服务接口时，请同步更新 `background.js` 与本 README。

---

## 📄 许可证

建议采用 MIT 协议开源（请在仓库根目录补充 `LICENSE` 文件）。本项目仅供学习与个人合规使用，请勿用于侵犯他人版权或违反平台规则的用途。
