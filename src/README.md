# 网页源文件

从项目根目录执行 `python3 -B src/build.py --output index.html`，即可生成完整的单文件网页，无需安装前端依赖。

- `core.js`：Web MIDI 传输、文件校验与 Bank 选择。
- `upload.js`：WAV 转换、波形生成与写入后核对。
- `pad.js`：Pad 设置、完整复制与保存。
- `app.js`、`upload-ui.js`、`pad-ui.js`：浏览、下载、上传和编辑界面。
- `page.html`、`style.css`：页面模板和样式。
- `build.py`：将以上文件合并到 `index.html`。

公开版本不包含实机采样或原始通信记录。不要将个人备份、固件和 App 安装包加入发布目录。
