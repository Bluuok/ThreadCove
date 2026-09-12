# ThreadCove 前端设计与移植

OpenDesign 使用用户选定的 **Local Codex** 模式，方向为桌面与响应式 Web、以核心流程为主的多个关联流程、精致产品界面。

- OpenDesign 项目：`threadcove-research-studio-5080`
- 运行：`e34f5534-1aa2-4afd-9a38-894c5299bbae`，已验证 succeeded。
- [本机原型预览](http://127.0.0.1:49292/api/projects/threadcove-research-studio-5080/raw/threadcove-studio.html)（需要 OpenDesign 本机服务运行）。
- 原始输出保存在 [设计参考](design/opendesign-reference.html) 和 [品牌规范](design/brand-spec.md)。

## 实际应用

`packages/ui` 是 Electron 与 Web 共用的真实 React 工作台。`design-tokens.css` 提取 OpenDesign 原始色彩变量；`workbench.css` 将纸白、森林绿、青绿应用到任务导航、消息区、操作区与执行详情。采用本机字体、CSS 图形和可复制文本，没有将原型截图当成界面。

主流程为新建任务 → 输入研究问题 → 查看实时回复 → 停止或继续。关联流程包括任务检索/归档、任务模型设置、来源与文件查看、权限响应、断线恢复及每任务草稿。设计强调输入和内容阅读；没有真实数据时显示空态。

桌面采用侧栏、会话区和可展开详情；390px Web 使用任务与详情抽屉。交互目标至少 44px；弹窗与移动抽屉支持焦点限制、Escape 与背景 inert；动画遵循 reduced-motion。任务切换后草稿独立保存。

## 验收与限制

真实 Chromium 和 Electron 使用同一实现，通过发送、停止、重载与历史恢复测试。移动端检查 390×844 下无横向溢出，发送操作处于首屏。截图见本地 `artifacts/qa/`。

OpenDesign 原型中的演示信息只作为布局参考，未移入真实消息或来源数据。此次视觉验收在 Windows 完成，macOS/Linux 原生窗口外观未验证。
