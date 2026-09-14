type Props = { onPrompt: (value: string) => void };

const prompts = [
  ['node-a', '01 / 一个疑问', '我想厘清一个问题：'],
  ['node-b', '02 / 找到依据', '请帮我列出研究这个问题需要寻找的关键证据：'],
  ['node-core', '连接，而非堆积', '请帮我比较这些线索，找到相互矛盾的地方：'],
  ['node-c', '03 / 新的洞见', '请把讨论整理成可验证的结论与下一步：'],
] as const;

export function ResearchMap({ onPrompt }: Props) {
  return <section className="research-map" aria-labelledby="map-title">
    <span className="map-label" id="map-title">FIG. 01 — 一次研究的生长路径</span>
    <svg viewBox="0 0 560 260" preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="field-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" /></pattern></defs><rect width="560" height="260" fill="url(#field-dots)"/><path d="M112 119 L282 171 L445 77 M282 171 L453 198 M112 119 L445 77"/><circle cx="282" cy="171" r="62" /></svg>
    {prompts.map(([className, label, prompt]) => <button key={className} className={`map-node ${className}`} onClick={() => onPrompt(prompt)}>{label}</button>)}
    <span className="map-caption">点击节点，把线索放进输入框</span>
  </section>;
}
