# Flow 划词（油猴脚本）

把 Flow 阅读器的划词翻译和朗读搬到普通网页上用。选词补全、翻译弹窗、多来源翻译、朗读结束自动关闭这些逻辑，都是从 `apps/reader/src/components/SelectionPopup.tsx` 和 `apps/reader/src/tts.ts` 移植过来的，体验跟 Flow 里一致。

## 安装

浏览器装好 Tampermonkey（或 Violentmonkey），打开下面的地址，点"安装"：

https://raw.githubusercontent.com/Yangjx96/flow/main/userscript/flow-select.user.js

之后这个仓库里脚本的版本号一变，油猴会自动更新。

## 用法

默认只在 economist.com（含所有子域名）生效。

- 选中文字后按 `D` 翻译、按 `S` 朗读；也可以在设置里改成"选中即触发"。手机上没有键盘，选中后总是直接触发。
- `Esc` 或点别处关闭；弹窗可以拖动，位置会记住；右下角拖动改大小。
- 页面滚动时，弹窗跟着选中的文字走。

加网站有两种方式：在要用的网站上点油猴菜单里的「在 xxx 启用划词」，或者打开菜单里的「设置」，在"生效的网站"里填域名（直接粘贴网址也行）。填主域名即可，子域名一起生效。

## 设置从哪来

第一次运行会从 Flow 的同步接口 `/api/sync/settings` 拉一份查词和朗读设置（API 配置、提示词、快捷键、触发方式等）。这一步借用浏览器里的 Flow 登录状态，所以要求这个浏览器登录过 flow.yangyichuan.com。

"跟随 Flow 的设置"开着时，打开网页会顺手检查一次（最多十分钟一次），Flow 那边改过就覆盖这里。想让网页和 Flow 用不同设置就关掉，在脚本自己的设置里改。

API 密钥存在油猴的脚本存储里，网页本身的脚本读不到。

## 请求怎么走

- AI 翻译和朗读：配置里有地址和密钥时直连上游（GM_xmlhttpRequest，不受网页 CORS/CSP 限制，不带 cookie）；失败再回退到 Flow 的 `/api/translate`、`/api/tts` 代理。
- 朗读模型被中转下线（"no available channel"）时，自动按 gpt-4o-mini-tts、tts-1、tts-1-hd 顺序换模型重试，和服务端一致。
- Google 翻译先直连，失败回退 Flow 代理。

## 本地调试

`dev/harness.html` 模拟了油猴的 GM_* 接口和所有上游接口（不发真实请求、不需要密钥），正文按经济学人的结构造了首字下沉、小型大写、软连字符和被标签拆开的单词。

```bash
python3 -m http.server 8765 --directory userscript
```

然后打开 http://localhost:8765/dev/harness.html，点顶部模拟菜单里的「在 localhost 启用划词」。控制台里可以改 `__mock`（`llmFail`、`ttsGone`、`flowLoggedIn` 等）测失败兜底，`__gmLog` 记录了每个请求。

改 Flow 里 SelectionPopup / tts 的交互时，记得把改动同步到这个脚本。
