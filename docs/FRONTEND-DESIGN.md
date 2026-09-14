# ThreadCove 前端设计与移植

OpenDesign 使用用户选定的 **Local Codex** 模式，方向为桌面与响应式 Web、以核心流程为主的多个关联流程、精致产品界面。

- 当前方向：**FIELDNOTES LAB / 研究图谱**。用户查看首版后要求更有创意的前端，取代原有海湾与森林绿方向。
- OpenDesign 项目：`threadcove-precision-workspace-080b`。
- 布局生成运行：`ccc19d6f-a3e3-4e6f-b2ac-1f075af6340d`，已验证 succeeded。雾蓝配色修订运行因本机服务重启失败，随后由 Codex 通过本机 MCP 定点更新并渲染验证；不将该失败运行标为成功。
- [本机原型工作室](http://127.0.0.1:53548/projects/threadcove-precision-workspace-080b/conversations/e47cae3e-ef78-4a3d-be03-1bb5c99efa95/files/index.html)（需要本次 OpenDesign 本机服务会话仍在运行）。
- 原始输出：[交互原型](design/fieldnotes/index.html)、[设计规格](design/fieldnotes/DESIGN.md)、[设计变量](design/fieldnotes/tokens.css)。
- 首版 [设计参考](design/opendesign-reference.html) 和 [品牌规范](design/brand-spec.md) 仅保留为历史材料，不再指导当前界面。

## 实际应用

`packages/ui` 是 Electron 与 Web 共用的真实 React 工作台。当前设计采用用户指定的低饱和雾蓝 / 灰蓝色系：窄深灰蓝身份栏、档案式任务索引、浅雾蓝工作纸面和克制蓝色主动作。首页以节点与批注组织线索，进入对话后收起图谱，消息保持稳定的 DOM 文本。

`useWorkbench.ts` 集中会话状态、连接订阅、流式消息、草稿和 API 操作；展示组件消费数据与具名动作；`design-tokens.css` 集中色彩、字体、间距与布局变量，`workbench.css` 管理响应式布局。换肤不需要修改后端或传输协议。没有移植原型的定时器回复、虚构任务或示例文件。

展示层组件位于 `packages/ui/src/components/`：`IdentityRail`、`TaskSidebar`、`ResearchMap`、`Conversation`、`Composer`、`DetailsPanel`、`SettingsDialog`。这些组件只接收类型化数据与动作回调，不持有 ElectronAPI。`Workbench` 负责组合与抽屉焦点管理。

基础色值：背景 `#edf2f5`、正文 `#263b4a`、辅助文字 `#586e7e`、主动作 `#4b6d87`。在背景上正文对比度约 10.31:1、辅助文字约 4.72:1，主按钮浅色文字约 5.12:1。

主流程为新建任务 → 输入研究问题 → 查看实时回复 → 停止或继续。关联流程包括任务检索/归档、任务模型设置、来源与文件查看、权限响应、断线恢复及每任务草稿。设计强调输入和内容阅读；没有真实数据时显示空态。

桌面采用身份栏、任务索引与研究画布；390px Web 使用任务与详情抽屉，输入区固定在可用视口底部。交互目标至少 44px；弹窗与移动抽屉支持焦点限制、Escape 与背景 inert；动画遵循 reduced-motion。任务切换后草稿独立保存。

## 图片策略

本版不需要生成图片，图谱由 SVG/CSS 与可交互 DOM 节点构成，不请求外部字体或图片。用户明确要求自行生成所需图片；若后续增加主视觉，应先提供用途、比例、尺寸与提示词，再接入用户提供的实际素材。

## 验收与限制

真实 Chromium 和 Electron 使用同一实现，通过发送、停止、重载与历史恢复测试。移动端检查 390×844 下无横向溢出，发送操作处于首屏。截图见本地 `artifacts/qa/`。

OpenDesign 原型中的演示信息只作为布局参考，未移入真实消息或来源数据。此次视觉验收在 Windows 完成，macOS/Linux 原生窗口外观未验证。
