import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Fragment, type ReactNode } from 'react';

/**
 * Question text in GenPrep's format: maths as $...$ (inline) or $$...$$ (own line),
 * pictures as {{IMG::https://...}}, **bold**, and line breaks.
 */
const IMG = /\{\{IMG::([^}]+?)\}\}/g;

function bold(s: string, key: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.length > 4 && p.startsWith('**') && p.endsWith('**') ? <strong key={`${key}b${i}`}>{p.slice(2, -2)}</strong> : <Fragment key={`${key}t${i}`}>{p}</Fragment>,
  );
}

function maths(s: string, key: string): ReactNode[] {
  if (!s.includes('$')) return bold(s, key);
  return s.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g).map((part, i) => {
    const block = part.length > 4 && part.startsWith('$$') && part.endsWith('$$');
    const inline = !block && part.length > 2 && part.startsWith('$') && part.endsWith('$');
    if (!block && !inline) return <Fragment key={`${key}-${i}`}>{bold(part, `${key}-${i}`)}</Fragment>;
    const html = katex.renderToString(block ? part.slice(2, -2) : part.slice(1, -1), { throwOnError: false, displayMode: block, output: 'html' });
    return <span key={`${key}-${i}`} dangerouslySetInnerHTML={{ __html: html }} />;
  });
}

export function MathText({ text, className }: { text: string; className?: string }) {
  const pieces = text.split(IMG);
  return (
    <span className={`math-text${className ? ` ${className}` : ''}`}>
      {pieces.map((piece, i) => {
        if (i % 2 === 0)
          return piece ? (
            <Fragment key={i}>
              {piece.split('\n').map((line, j, all) => (
                <Fragment key={j}>
                  {maths(line, `${i}.${j}`)}
                  {j < all.length - 1 && <br />}
                </Fragment>
              ))}
            </Fragment>
          ) : null;
        const url = piece.split('|')[0].trim();
        return /^https:\/\//.test(url) ? <img key={i} className="math-img" src={url} alt="Diagram" loading="lazy" /> : null;
      })}
    </span>
  );
}
