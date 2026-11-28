CogniRogue — Windows x64 完整版

1. 完整解压 ZIP（不要直接在压缩包里运行）。
2. 双击 Start-CogniRogue.cmd，会自动在默认浏览器打开游戏。
3. 导入题库、PDF 或 Markdown 无需另装 Python、Node.js 或 uv。
   使用模型分章或生成题目之前，在「设置 → 出题模型」填写自己的模型配置；
   只有模型相关操作需要访问你配置的模型接口。
4. 按启动窗口里的 Ctrl+C 停止游戏。只关闭浏览器不会停止后台任务。
   再双击启动文件会打开正在运行的实例。

本机地址：http://127.0.0.1:17777/
数据和启动日志：%LOCALAPPDATA%\CogniRogue
升级时先退出，再把新版解压到新目录运行；题库、文档和答题记录不在解压目录里。
游戏界面偏好由打开游戏的浏览器保存；更换浏览器或清除站点数据不会迁移这些偏好。
源码运行产生的数据不会被自动迁移到这个目录。

如果启动提示缺少 Visual C++ 运行库，请从 Microsoft 安装 v14 x64 运行库后重新启动：
https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist

组件说明：
- 项目许可证见 LICENSE，内置语料来源见 SOURCES.md。
- Node.js 与 Python 的许可证分别放在 runtime/node 与 runtime/python 中。
- Python 包的许可证保留在各自的 site-packages 元数据中；PDF 引擎为 PyMuPDF。
