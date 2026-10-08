import { parseBlocks } from '../lib/richtext';

// Renders the safe Markdown subset from lib/richtext.js as React elements.
function Inline({ nodes }) {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'bold': return <strong key={i}>{n.text}</strong>;
      case 'italic': return <em key={i}>{n.text}</em>;
      case 'code': return <code key={i}>{n.text}</code>;
      case 'mention': return <span key={i} className="mention">@{n.text}</span>;
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{n.text}</a>;
      default: return <span key={i}>{n.text}</span>;
    }
  });
}

export default function RichText({ text, className = '' }) {
  return (
    <div className={`rich ${className}`.trim()}>
      {parseBlocks(text).map((b, i) => {
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type;
          return <List key={i}>{b.items.map((item, j) => <li key={j}><Inline nodes={item} /></li>)}</List>;
        }
        if (b.type === 'break') return null;
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <span key={j}>{j > 0 && <br />}<Inline nodes={line} /></span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
