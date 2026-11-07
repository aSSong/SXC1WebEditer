# SXC-1 Web Editor

CASIO SXC-1 非官方网页采样管理器。通过 USB 和 Web MIDI 直接与机器通信，无需修改固件或安装官方 App。

**在线使用：[打开采样管理器](https://assong.github.io/SXC1WebEditer/)**

## 开始使用

1. 在电脑的 Chrome 或 Edge 中打开上面的 HTTPS 地址。
2. 正常开启 SXC-1，用支持数据传输的 USB 线连接机器的 **DATA** 接口。
3. 退出官方 App 和其他正在连接机器的编辑器。
4. 点击「连接 SXC-1」，允许浏览器访问 MIDI / SysEx。

已在 macOS + Chrome + SXC-1 固件 **1.4.1** 上完成实机验证。其他系统、浏览器与固件尚未完成实机验证；设备连接需要浏览器支持 Web MIDI / SysEx。

## 功能

- 按 80 个 Bank 浏览采样，网页翻页时机器跟随切换。
- Pad 1 在左下，四行依次为 13–16 / 9–12 / 5–8 / 1–4。
- Pad 右上角 Loop 开关控制网页循环试听，支持播放中切换；不修改机器上的 Loop 参数。
- 试听、下载单个原始 WAV、下载整页 ZIP（音频、Pad 设置和校验清单，不含 Pattern）。
- 选择或直接拖入 WAV 到空 Pad，自动转换并生成机器屏幕所需的波形。
- 复制 Pad 到同一或其他 Bank 的空 Pad，保留原始音频、波形、起止点、设置及关联文件。
- 编辑 Level、Pitch、Group、LED Color、Pan、One Shot、Loop、BPM，保存后读回核对。
- 打开本地备份文件夹，离线浏览、试听和下载。

上传支持最长 60 秒、最大 64 MB 的单/双声道 WAV（PCM 8/16/24/32-bit、Float 32-bit，8–192 kHz），转换为 48 kHz / 16-bit 双声道。上传和粘贴仅允许空 Pad，已有采样或设置文件的 Pad 不可覆盖。普通上传使用默认设置；复制会保留原 Pad 设置。

Level 范围为 0–100%；Pitch 为 ±24 半音，会同时改变速度。网页试听播放原始 WAV，不模拟机器的播放参数。起止点可保留和复制，暂不提供编辑。机器上手动翻页不会反向同步网页。写入期间保持连接并避免同时操作设备；如提示结果待核对，请重新连接检查目标 Pad。

## 文件与隐私

音频转换、试听、备份读取与 USB 通信都在浏览器本地完成；本工具不会把采样或设备备份上传到网站服务器。浏览器会在本地保留最近一次上传和编辑记录；关闭页面会清空临时音频缓存和复制剪贴板。GitHub Pages 提供网页文件的托管服务。

本仓库只发布网页及源代码，不包含设备采样、通信记录、固件或官方 App 安装包。

## 本地运行与更新

根目录 `index.html` 是无外部前端依赖的单文件页面。需要本地运行时，在仓库目录执行：

```sh
python3 -m http.server 8764 --bind 127.0.0.1
```

然后打开 `http://localhost:8764/`。在线版直接使用 HTTPS 地址即可。

修改 `src/` 后重新构建：

```sh
python3 -B src/build.py --output index.html
```

将更新后的源文件和 `index.html` 提交到 `main`。GitHub Pages 使用 `main` 分支根目录发布，提交后会自动更新网站。`.nojekyll` 保留在根目录。

## 研究参考

协议研究参考了 [neuvecom/casio_sxc-1_lab](https://github.com/neuvecom/casio_sxc-1_lab)。本工具是非官方项目，与 CASIO 无隶属关系。
