---
"@neta-art/cohub": patch
"@neta-art/cohub-cli": patch
---

A lighter, faster CLI. The Board renderer and PixiJS are bundled into `boards export` and load only when exporting, and sharp loads only for image uploads, so the install shrinks from about 156 MB to 70 MB and every command starts about 0.2 s faster. Self-update now checks the registry first and reinstalls only for a newer release, instead of reinstalling every 6 hours, which briefly removed the `cohub` bin while other commands ran; the last check is recorded in `~/.cache/cohub-cli/self-update.json`. `boards export` now renders with Geist like the web app: the font files ship with the CLI (about 100 KB) instead of being looked up in a package it never installed, and symbols Geist lacks, such as subscripts and superscripts, fall back to a host sans instead of drawing as boxes.

CLI 更轻更快。Board 渲染器和 PixiJS 打包进 `boards export`，只在导出时加载；sharp 只在上传图片时加载。安装体积从约 156 MB 降到 70 MB，每条命令启动快约 0.2 秒。自更新先查询 registry，只有新版本才重装，不再每 6 小时无条件重装（重装期间 `cohub` 命令会短暂消失，影响同时运行的命令）；最近一次检查记录在 `~/.cache/cohub-cli/self-update.json`。`boards export` 现在和网页一样用 Geist 渲染：字体文件随 CLI 一起发布（约 100 KB），不再去一个从未安装的包里查找；Geist 没有的符号（如上下标）会回退到系统无衬线字体，不再显示成方框。
