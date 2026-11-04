import { parseBlocks } from '../lib/richtext';

// Renders the safe Markdown subset from lib/richtext.js as React elements.
function Inline({ nodes }) {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'bold': return <strong key={i}>{n.text}</strong>;
      case 'italic': return <em key={i}>{n.text}</em>;
      case 'underline': return <u key={i}>{n.text}</u>;
      case 'strike': return <s key={i}>{n.text}</s>;
      case 'highlight': return <mark key={i}>{n.text}</mark>;
      case 'code': return <code key={i}>{n.text}</code>;
      case 'mention': return <span key={i} className="mention">@{n.text}</span>;
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{n.text}</a>;
      default: return <span key={i}>{n.text}</span>;
    }
  });
}

const Lines = ({ lines }) => lines.map((line, j) => <span key={j}>{j > 0 && <br />}<Inline nodes={line} /></span>);

const HEADINGS = { 1: 'h3', 2: 'h4', 3: 'h5' };

export default function RichText({ text, className = '' }) {
  return (
    <div className={`rich ${className}`.trim()}>
      {parseBlocks(text).map((b, i) => {
        switch (b.type) {
          case 'ul':
          case 'ol': {
            const List = b.type;
            return <List key={i}>{b.items.map((item, j) => <li key={j}><Inline nodes={item} /></li>)}</List>;
          }
          case 'h': {
            const H = HEADINGS[b.level];
            return <H key={i} className={`rich-h${b.level}`}><Inline nodes={b.nodes} /></H>;
          }
          case 'quote': return <blockquote key={i}><Lines lines={b.lines} /></blockquote>;
          case 'codeblock': return <pre key={i}><code>{b.text}</code></pre>;
          case 'hr': return <hr key={i} />;
          case 'table':
            return (
              <div key={i} className="rich-table">
                <table>
                  {b.head && <thead><tr>{b.head.map((c, j) => <th key={j}><Inline nodes={c} /></th>)}</tr></thead>}
                  <tbody>
                    {b.rows.map((row, r) => <tr key={r}>{row.map((c, j) => <td key={j}><Inline nodes={c} /></td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            );
          case 'embed':
            return (
              <div key={i} className="rich-embed">
                <iframe src={b.src} title={`${b.provider} video`} loading="lazy" allowFullScreen
                  allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin"
                  sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" />
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="hint">{b.provider} · open in a new tab</a>
              </div>
            );
          case 'break': return null;
          default: return <p key={i}><Lines lines={b.lines} /></p>;
        }
      })}
    </div>
  );
}
