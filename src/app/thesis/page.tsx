import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Thesis", description: "The claim, the evidence for it, the evidence against it, and what would change our mind." };

/** Inline markdown: **bold**, `code`, [text](url). Enough for THESIS.md, which the pipeline writes. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!;
      out.push(
        <a key={k} href={href}>
          {label}
        </a>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function render(md: string): ReactNode[] {
  const lines = md.split(/\r?\n/);
  const out: ReactNode[] = [];
  let i = 0;
  const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) i++;
    else if (line.startsWith("# ")) out.push(<h1 key={k}>{inline(line.slice(2), k)}</h1>), i++;
    else if (line.startsWith("## ")) out.push(<h2 key={k}>{inline(line.slice(3), k)}</h2>), i++;
    else if (line.startsWith("### ")) out.push(<h3 key={k}>{inline(line.slice(4), k)}</h3>), i++;
    else if (line.startsWith("> ")) out.push(<blockquote key={k}>{inline(line.slice(2), k)}</blockquote>), i++;
    else if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      out.push(
        <div key={k} className="scroll-x">
          <table>
            <thead>
              <tr>
                {cells(head).map((c, j) => (
                  <th key={j}>{inline(c, `${k}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {cells(r).map((c, j) => (
                    <td key={j} className={j > 0 && /^[($\d-]/.test(c.replace(/\*/g, "")) ? "num" : undefined}>
                      {inline(c, `${k}r${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, ""));
      const lis = items.map((t, j) => <li key={j}>{inline(t, `${k}l${j}`)}</li>);
      out.push(ordered ? <ol key={k}>{lis}</ol> : <ul key={k}>{lis}</ul>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#|>|\||- |\d+\. )/.test(lines[i])) para.push(lines[i++]);
      out.push(<p key={k}>{inline(para.join(" "), k)}</p>);
    }
  }
  return out;
}

export default function Page() {
  const md = readFileSync(resolve(process.cwd(), "THESIS.md"), "utf8");
  return (
    <div className="shell py-16 md:py-24">
      <div className="eyebrow mb-8">Thesis / generated from the data, not typed</div>
      <article className="prose-thesis mx-auto max-w-[820px]">{render(md)}</article>
    </div>
  );
}
