# 网页源文件

从项目根目录执行 `python3 -B src/build.py --output index.html`，即可生成完整的单文件网页，无需安装前端依赖。

- `core.js`：Web MIDI 传输、文件校验与 Bank 选择。
- `upload.js`：WAV 转换、波形生成与写入后核对。
- `pad.js`：Pad 设置、完整复制与保存。
- `batch.js`、`batch-ui.js`：音频/文件夹列表、连续空位预检、批量队列和重试窗口。
- `actions-ui.js`：音频导入、备份和本地浏览的操作分组，以及键盘/焦点行为。
- `backup.js`、`backup-ui.js`：全部 Bank 的只读文件夹导出、空音频过滤、逐文件核对与完成清单。
- `app.js`、`upload-ui.js`、`pad-ui.js`：浏览、下载、上传和编辑界面。
- `page.html`、`style.css`：页面模板和样式。
- `build.py`：将以上文件合并到 `index.html`。

公开版本不包含实机采样或原始通信记录。不要将个人备份、固件和 App 安装包加入发布目录。

批量逻辑的离线测试：`node src/test-batch.cjs`。测试使用生成的音频和模拟设备，不连接实机；覆盖跨 Bank、占用阻止写入、文件校验、重试、停止及中断核对。

## 界面本地化 / Interface localization

`i18n.js` 提供 `SXCI18n`；`locales/en.json` 以中文原文模板为键保存英文文案，构建时内嵌到单文件页面。新增模板时，中英文必须保留相同的 `{namedPlaceholder}`，不要翻译文件名、路径、协议字段或用户数据。用 `msg(source, params)` 保存可重绘的文案描述，再通过 `text(element, message)` 或 `attr(element, name, message)` 绑定；参数字符串按原样输出，不作为 HTML。`raw(formattedText)` 兼容已格式化的已知文案，未知内容按原样保留。缺失参数保留占位符，便于排查。

`setLanguage('en' | 'zh-CN')` 只更新界面绑定、页面语言及标题等文案，不重载页面，不改变 MIDI、网络或连接状态。选择保存在 localStorage 的 `sxc-language`；存储不可用时仍可切换。未保存选择时，以浏览器的首选语言判断：`zh*` 使用简体中文，其他或空值使用 English。

Run `node src/test-i18n.cjs` for offline localization tests. The suite checks language/preference fallback, placeholder parity and literal user data, template recovery, live text/ARIA updates, and deterministic builds. It uses a fake document with device/network access blocked; it does not validate behavior on a physical SXC-1. English user documentation: [README.en.md](../README.en.md).

## 全 Bank 备份 / All-bank backup

`node --test src/test-backup.cjs` uses in-memory MIDI and filesystem adapters. It checks sparse bank selection, literal audio/settings, exported manifest compatibility, output verification and failure/cancellation behavior. No physical device is accessed. The exporter calls directory/read only, bypasses the preview cache, and never invokes Bank selection or device-write methods. The browser saves to a fresh subfolder selected through its folder-access dialog.

The action groups use native disclosure controls, with Enter/Space, normal Tab navigation, Escape focus return and outside-click closing. Design reference: [W3C Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/). Audio import and backup browsing remain distinct operations; opening an archive does not restore it to the sampler.
