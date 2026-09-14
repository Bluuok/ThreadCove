# ThreadCove 视觉规范

来源：本次用户明确指定的温暖纸白、深森林绿、低饱和青绿与编辑式排版。未提供既有数值，下列为本原型新制定的设计值，不宣称提取自现有品牌。

```css
:root {
  --bg: oklch(97.3% 0.012 88);
  --surface: oklch(99% 0.006 88);
  --fg: oklch(28% 0.031 166);
  --muted: oklch(48% 0.020 162);
  --border: oklch(86% 0.016 90);
  --accent: oklch(44% 0.065 175);
  --font-display: "Iowan Old Style", "Palatino Linotype", "Noto Serif SC", "Songti SC", "SimSun", serif;
  --font-body: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-mono: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
}
```

1. 森林绿仅承担任务导航与关键操作，纸白用于持续阅读；青绿用于当前执行状态与焦点反馈。
2. 衬线标题、无衬线正文与等宽编号形成编辑式层级，不依赖大面积插图、渐变与彩色卡片。
3. 以细分隔线、留白和自然文本结构组织研究成果；卡片仅用于输入和明确可操作的容器。
4. 主输入始终处于视口内；桌面执行栏可折叠，手机以模态抽屉承载辅助内容。
5. 全部示例结果和资料明确标注；文字为可选择的 DOM 文本，无图片和外部字体依赖。
