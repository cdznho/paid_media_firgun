"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const defaultInput = path.resolve(__dirname, "..", "deep-research-report2.md");
const defaultOutput = path.resolve(
  __dirname,
  "..",
  "index.html"
);
const inputPath = path.resolve(args[0] || defaultInput);
const outputPath = path.resolve(args[1] || defaultOutput);

function stripResearchArtifacts(markdown) {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/entity\["[^"]*","([^"]+)".*?/g, "$1")
    .replace(/cite.*?/g, "")
    .replace(/entity.*?/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function looksLikeTable(lines, index) {
  if (index + 1 >= lines.length) return false;
  const first = lines[index].trim();
  const second = lines[index + 1].trim();
  return first.startsWith("|") && /^\|?[\s:\-|]+\|?$/.test(second);
}

function parseMarkdown(markdown) {
  const lines = markdown.split("\n");
  const tokens = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      tokens.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const lang = trimmed.replace(/^```/, "").trim();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      tokens.push({
        type: "code",
        lang,
        content: codeLines.join("\n").trim(),
      });
      continue;
    }

    if (looksLikeTable(lines, i)) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i += 1;
      }
      tokens.push({
        type: "table",
        headers: splitTableRow(tableLines[0]),
        rows: tableLines
          .slice(2)
          .map((tableLine) => splitTableRow(tableLine))
          .filter((row) => row.some(Boolean)),
      });
      continue;
    }

    const listMatch = trimmed.match(/^(\-|\*|\d+[.)])\s+(.*)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items = [];

      while (i < lines.length) {
        const raw = lines[i];
        const rawTrimmed = raw.trim();
        if (!rawTrimmed) {
          i += 1;
          break;
        }
        const itemMatch = rawTrimmed.match(/^(\-|\*|\d+[.)])\s+(.*)$/);
        if (itemMatch) {
          items.push(itemMatch[2].trim());
          i += 1;
          continue;
        }
        if (
          /^\s+/.test(raw) &&
          items.length &&
          !/^#{1,6}\s+/.test(rawTrimmed) &&
          !rawTrimmed.startsWith("|") &&
          !/^```/.test(rawTrimmed)
        ) {
          items[items.length - 1] = `${items[items.length - 1]} ${rawTrimmed}`;
          i += 1;
          continue;
        }
        break;
      }

      tokens.push({
        type: "list",
        ordered,
        items,
      });
      continue;
    }

    const paragraphLines = [trimmed];
    i += 1;
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrimmed = nextLine.trim();
      if (
        !nextTrimmed ||
        /^#{1,6}\s+/.test(nextTrimmed) ||
        /^```/.test(nextTrimmed) ||
        looksLikeTable(lines, i) ||
        /^(\-|\*|\d+[.)])\s+/.test(nextTrimmed)
      ) {
        break;
      }
      paragraphLines.push(nextTrimmed);
      i += 1;
    }
    tokens.push({
      type: "paragraph",
      text: paragraphLines.join(" "),
    });
  }

  return tokens;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(markdown) {
  let text = escapeHtml(markdown || "");
  const codeBits = [];

  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `__CODE_${codeBits.length}__`;
    codeBits.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt) => escapeHtml(alt));
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, href) =>
      `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  codeBits.forEach((html, index) => {
    text = text.replace(`__CODE_${index}__`, html);
  });

  return text;
}

function plainText(markdown) {
  return (markdown || "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text, seen) {
  const base = plainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
  const count = seen.get(base) || 0;
  seen.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

function sentenceSummary(text, maxChars = 260) {
  const cleaned = plainText(text);
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  let summary = "";
  for (const sentence of sentences) {
    const next = summary ? `${summary} ${sentence}` : sentence;
    if (next.length > maxChars && summary) break;
    summary = next;
    if (summary.length >= maxChars) break;
  }
  return summary || cleaned;
}

function getHeroSummary(tokens) {
  const summaryHeadingIndex = tokens.findIndex(
    (token) =>
      token.type === "heading" &&
      token.level === 2 &&
      plainText(token.text).toLowerCase() === "executive summary"
  );

  if (summaryHeadingIndex === -1) return "";

  for (let i = summaryHeadingIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "paragraph") {
      return sentenceSummary(token.text);
    }
    if (token.type === "heading" && token.level <= 2) break;
  }
  return "";
}

function extractHeroMetrics(markdown) {
  const metrics = [];
  const engaged = markdown.match(
    /(\d{1,3}(?:,\d{3})+)\s+quantum-engaged organisations/i
  );
  const purePlay = markdown.match(
    /(\d{1,3}(?:,\d{3})+)\s+pure-play quantum companies/i
  );
  const budget = markdown.match(/(£\d+k\s*[-–]\s*£?\d+k\/month)/i);

  if (engaged) {
    metrics.push({
      value: engaged[1],
      label: "quantum-engaged organisations",
    });
  }
  if (purePlay) {
    metrics.push({
      value: purePlay[1],
      label: "pure-play quantum companies",
    });
  }
  if (budget) {
    metrics.push({
      value: budget[1].replace(/\s+/g, ""),
      label: "early monthly test budget",
    });
  }

  if (!metrics.length) {
    return [
      { value: "Series A/B", label: "core investment focus" },
      { value: "ABM-led", label: "LP acquisition posture" },
      { value: "Precision", label: "paid media operating model" },
    ];
  }

  return metrics.slice(0, 3);
}

function extractSignals(markdown) {
  const signals = [];
  if (/compliance-first/i.test(markdown) || /professional\/institutional\/sophisticated investors/i.test(markdown)) {
    signals.push("Compliance-first LP motion");
  }
  if (/podcast/i.test(markdown) || /newsletter/i.test(markdown) || /events/i.test(markdown)) {
    signals.push("Credibility, content, and ecosystem amplification");
  }
  if (/qualified conversations/i.test(markdown) || /precision/i.test(markdown)) {
    signals.push("Designed for qualified conversations, not lead volume");
  }
  return signals.slice(0, 4);
}

function parseMermaidGantt(content) {
  const rows = [];
  let currentSection = "";

  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("section ")) {
      currentSection = trimmed.replace(/^section\s+/, "");
      return;
    }
    if (
      trimmed === "gantt" ||
      trimmed.startsWith("title ") ||
      trimmed.startsWith("dateFormat ") ||
      trimmed.startsWith("axisFormat ")
    ) {
      return;
    }
    const separatorIndex = trimmed.lastIndexOf(":");
    if (separatorIndex === -1) return;
    const task = plainText(trimmed.slice(0, separatorIndex));
    const timing = trimmed
      .slice(separatorIndex + 1)
      .split(",")
      .map((part) => plainText(part));
    rows.push({
      phase: currentSection,
      task,
      start: timing[1] || "",
      duration: timing[2] || "",
    });
  });

  return rows;
}

function renderTable(headers, rows, extraClass = "") {
  const head = `<thead><tr>${headers
    .map((header) => `<th>${renderInline(header)}</th>`)
    .join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${renderInline(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("")}</tbody>`;

  return `<div class="table-wrap ${extraClass}"><table>${head}${body}</table></div>`;
}

function renderCodeBlock(token) {
  if (
    token.lang &&
    token.lang.toLowerCase() === "mermaid" &&
    /\bgantt\b/i.test(token.content)
  ) {
    const rows = parseMermaidGantt(token.content);
    const phaseGroups = [];

    rows.forEach((row) => {
      const lastGroup = phaseGroups[phaseGroups.length - 1];
      if (!lastGroup || lastGroup.phase !== row.phase) {
        phaseGroups.push({ phase: row.phase, rows: [row] });
      } else {
        lastGroup.rows.push(row);
      }
    });

    return `
      <div class="timeline-block">
        <div class="timeline-meta">
          <p class="timeline-label">90-day launch timeline</p>
          <p class="timeline-copy">Converted from the markdown gantt block into a structured rollout timeline.</p>
        </div>
        <div class="timeline-groups">
          ${phaseGroups
            .map(
              (group) => `
                <section class="timeline-group">
                  <h4>${escapeHtml(group.phase)}</h4>
                  ${group.rows
                    .map(
                      (row) => `
                        <div class="timeline-row">
                          <div class="timeline-task">${escapeHtml(row.task)}</div>
                          <div class="timeline-date">${escapeHtml(row.start)}</div>
                          <div class="timeline-duration">${escapeHtml(row.duration)}</div>
                        </div>
                      `
                    )
                    .join("")}
                </section>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  return `
    <div class="code-block">
      ${
        token.lang
          ? `<div class="code-label">${escapeHtml(token.lang)}</div>`
          : ""
      }
      <pre><code>${escapeHtml(token.content)}</code></pre>
    </div>
  `;
}

function buildDocument(tokens, markdown) {
  const slugCounts = new Map();
  const h1 = tokens.find((token) => token.type === "heading" && token.level === 1);
  const title = h1 ? plainText(h1.text) : "Firgun report";
  const heroSummary = getHeroSummary(tokens);
  const heroMetrics = extractHeroMetrics(markdown);
  const heroSignals = extractSignals(markdown);
  const tocItems = [];

  let chapterIndex = 0;
  tokens.forEach((token) => {
    if (token.type === "heading" && token.level >= 2 && token.level <= 3) {
      const id = slugify(token.text, slugCounts);
      token.id = id;
      if (token.level === 2) chapterIndex += 1;
      tocItems.push({
        level: token.level,
        id,
        number: token.level === 2 ? String(chapterIndex).padStart(2, "0") : "",
        label: plainText(token.text),
      });
    }
  });

  let rendered = "";
  let currentChapter = null;
  let currentSubsectionOpen = false;
  chapterIndex = 0;

  const closeSubsection = () => {
    if (currentSubsectionOpen) {
      rendered += "</div>";
      currentSubsectionOpen = false;
    }
  };

  const closeChapter = () => {
    closeSubsection();
    if (currentChapter) {
      rendered += "</div></section>";
      currentChapter = null;
    }
  };

  tokens.forEach((token) => {
    if (token.type === "heading") {
      if (token.level === 1) return;

      if (token.level === 2) {
        closeChapter();
        chapterIndex += 1;
        currentChapter = token.id;
        rendered += `
          <section class="chapter reveal" id="${token.id}">
            <header class="chapter-head">
              <div class="chapter-number">${String(chapterIndex).padStart(2, "0")}</div>
              <div class="chapter-title-wrap">
                <p class="chapter-kicker">Report section</p>
                <h2>${renderInline(token.text)}</h2>
              </div>
            </header>
            <div class="chapter-body">
        `;
        return;
      }

      if (token.level === 3) {
        closeSubsection();
        rendered += `
          <div class="subsection reveal" id="${token.id}">
            <p class="subsection-kicker">Focus area</p>
            <h3>${renderInline(token.text)}</h3>
        `;
        currentSubsectionOpen = true;
      }
      return;
    }

    if (!currentChapter) return;

    if (token.type === "paragraph") {
      rendered += `<p>${renderInline(token.text)}</p>`;
      return;
    }

    if (token.type === "list") {
      const tag = token.ordered ? "ol" : "ul";
      rendered += `<${tag} class="report-list">${token.items
        .map((item) => `<li>${renderInline(item)}</li>`)
        .join("")}</${tag}>`;
      return;
    }

    if (token.type === "table") {
      rendered += renderTable(token.headers, token.rows);
      return;
    }

    if (token.type === "code") {
      rendered += renderCodeBlock(token);
    }
  });

  closeChapter();

  const toc = tocItems
    .map(
      (item) => `
        <li class="toc-item toc-level-${item.level}">
          <a href="#${item.id}" data-target="${item.id}">
            ${
              item.number
                ? `<span class="toc-number">${item.number}</span>`
                : `<span class="toc-bullet">·</span>`
            }
            <span class="toc-label">${escapeHtml(item.label)}</span>
          </a>
        </li>
      `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | Firgun formatted</title>
    <meta
      name="description"
      content="${escapeHtml(heroSummary || title)}"
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&family=Courier+Prime:wght@400;700&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --firgun-green: #7e9f80;
        --firgun-green-dark: #4b5f4c;
        --firgun-green-mid: #647e66;
        --grey-green: #c3cfc5;
        --grey-green-dark: #747c76;
        --grey-green-light: #dae2db;
        --sand: #e1ddd4;
        --sand-dark: #87847f;
        --sand-light: #edeae4;
        --paper: #ffffff;
        --ink: #0c0c0c;
        --muted: #5d625e;
        --line: rgba(12, 12, 12, 0.12);
        --line-strong: rgba(12, 12, 12, 0.22);
        --shadow: 0 24px 70px rgba(12, 12, 12, 0.08);
        --max-width: 1460px;
        --content-width: 860px;
        --radius: 26px;
      }

      * {
        box-sizing: border-box;
      }

      html {
        scroll-behavior: smooth;
      }

      body {
        margin: 0;
        background:
          linear-gradient(rgba(116, 124, 118, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(116, 124, 118, 0.08) 1px, transparent 1px),
          var(--sand-light);
        background-size: 72px 72px, 72px 72px, auto;
        color: var(--ink);
        font-family: "Courier Prime", ui-monospace, SFMono-Regular, Menlo, monospace;
        text-rendering: optimizeLegibility;
      }

      a {
        color: inherit;
        text-decoration-color: rgba(126, 159, 128, 0.85);
        text-underline-offset: 0.18em;
      }

      img {
        max-width: 100%;
        display: block;
      }

      .progress {
        position: fixed;
        inset: 0 auto auto 0;
        width: 100%;
        height: 3px;
        background: transparent;
        z-index: 80;
      }

      .progress > span {
        display: block;
        width: 0;
        height: 100%;
        background: linear-gradient(90deg, var(--firgun-green-dark), var(--firgun-green));
        transform-origin: left center;
      }

      .hero {
        position: relative;
        overflow: clip;
        min-height: 96svh;
        display: grid;
        align-items: end;
        padding: 2rem 2rem 3.25rem;
      }

      .hero::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 78% 22%, rgba(126, 159, 128, 0.22), transparent 28%),
          radial-gradient(circle at 88% 68%, rgba(195, 207, 197, 0.75), transparent 28%),
          linear-gradient(135deg, rgba(225, 221, 212, 0.9), rgba(237, 234, 228, 0.96) 48%, rgba(195, 207, 197, 0.75) 100%);
        z-index: 0;
      }

      .hero::after {
        content: "";
        position: absolute;
        right: 3.5rem;
        top: 1.75rem;
        width: min(34vw, 420px);
        aspect-ratio: 1 / 1.15;
        border: 1px solid rgba(12, 12, 12, 0.12);
        border-radius: 34px;
        background:
          radial-gradient(circle, rgba(75, 95, 76, 0.28) 0.9px, transparent 1px),
          linear-gradient(180deg, rgba(255, 255, 255, 0.66), rgba(225, 221, 212, 0.22));
        background-size: 11px 11px, auto;
        box-shadow: var(--shadow);
        opacity: 0.9;
        z-index: 1;
      }

      .hero-shell {
        position: relative;
        z-index: 2;
        width: min(100%, var(--max-width));
        margin: 0 auto;
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.72fr);
        gap: 3.5rem;
        align-items: end;
      }

      .hero-copy {
        max-width: 740px;
      }

      .brand-lockup {
        display: inline-flex;
        flex-direction: column;
        gap: 0.1rem;
        margin-bottom: 1.8rem;
      }

      .brand-lockup strong {
        font-family: "Roboto", system-ui, sans-serif;
        font-size: 0.92rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .brand-lockup span {
        color: var(--firgun-green-dark);
        font-size: 0.9rem;
      }

      .site-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 1.45rem;
        color: rgba(12, 12, 12, 0.72);
        font-size: 0.94rem;
      }

      .site-nav a {
        text-decoration: none;
        transition: color 180ms ease;
      }

      .site-nav a:hover {
        color: var(--ink);
      }

      .hero-kicker {
        margin: 0 0 0.85rem;
        color: var(--firgun-green-dark);
        font-size: 0.95rem;
      }

      h1,
      h2,
      h3,
      h4 {
        margin: 0;
        font-family: "Roboto", system-ui, sans-serif;
        line-height: 0.98;
        font-weight: 900;
        letter-spacing: -0.04em;
      }

      h1 {
        max-width: 11ch;
        font-size: clamp(3.6rem, 8vw, 7rem);
      }

      .hero-summary {
        max-width: 58ch;
        margin: 1.5rem 0 0;
        font-size: 1.08rem;
        line-height: 1.7;
        color: rgba(12, 12, 12, 0.82);
      }

      .hero-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1.1rem;
        margin-top: 1.9rem;
        padding-top: 1.2rem;
        border-top: 1px solid var(--line-strong);
      }

      .hero-metric {
        min-width: 0;
      }

      .hero-metric strong {
        display: block;
        font-family: "Roboto", system-ui, sans-serif;
        font-size: clamp(1.35rem, 2vw, 1.9rem);
        letter-spacing: -0.04em;
      }

      .hero-metric span {
        display: block;
        margin-top: 0.28rem;
        font-size: 0.92rem;
        line-height: 1.45;
        color: var(--muted);
      }

      .hero-signal-plane {
        position: relative;
        min-height: 540px;
        padding: 1.7rem;
        border-radius: 32px;
        border: 1px solid rgba(12, 12, 12, 0.12);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.52), rgba(255, 255, 255, 0.14)),
          rgba(195, 207, 197, 0.5);
        box-shadow: var(--shadow);
      }

      .hero-signal-plane::before {
        content: "";
        position: absolute;
        inset: 1.1rem;
        border-radius: 24px;
        border: 1px solid rgba(12, 12, 12, 0.08);
        pointer-events: none;
      }

      .hero-signal-plane::after {
        content: "";
        position: absolute;
        inset: auto 2rem 2rem auto;
        width: 44%;
        aspect-ratio: 1 / 1;
        border-radius: 50%;
        background:
          radial-gradient(circle, rgba(75, 95, 76, 0.22) 1px, transparent 1px);
        background-size: 10px 10px;
        opacity: 0.85;
      }

      .hero-signal-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 2.2rem;
      }

      .hero-signal-top p {
        margin: 0;
      }

      .signal-label {
        color: var(--firgun-green-dark);
        font-size: 0.9rem;
      }

      .signal-title {
        font-family: "Roboto", system-ui, sans-serif;
        font-size: 1.55rem;
        letter-spacing: -0.05em;
      }

      .hero-signals {
        display: grid;
        gap: 1rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .hero-signals li {
        position: relative;
        padding: 0 0 0.95rem 1.25rem;
        border-bottom: 1px solid rgba(12, 12, 12, 0.12);
        font-size: 1rem;
        line-height: 1.7;
      }

      .hero-signals li::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0.55rem;
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background: var(--firgun-green-dark);
      }

      .hero-signals li:last-child {
        border-bottom: none;
      }

      .page-shell {
        width: min(100%, var(--max-width));
        margin: 0 auto;
        padding: 2rem;
        display: grid;
        grid-template-columns: minmax(210px, 250px) minmax(0, 1fr);
        gap: 3rem;
        align-items: start;
      }

      .toc {
        position: sticky;
        top: 1.35rem;
        padding: 1.15rem 0 1.5rem 1rem;
        border-left: 1px solid var(--line-strong);
      }

      .toc h2 {
        font-size: 1rem;
        letter-spacing: -0.02em;
      }

      .toc p {
        margin: 0.35rem 0 1.2rem;
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.55;
      }

      .toc-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 0.18rem;
      }

      .toc-item a {
        display: grid;
        grid-template-columns: 2rem 1fr;
        gap: 0.65rem;
        align-items: start;
        padding: 0.5rem 0.7rem;
        border-radius: 14px;
        color: rgba(12, 12, 12, 0.74);
        text-decoration: none;
        transition: background-color 180ms ease, color 180ms ease, transform 180ms ease;
      }

      .toc-item a:hover,
      .toc-item a.is-active {
        background: rgba(255, 255, 255, 0.75);
        color: var(--ink);
        transform: translateX(2px);
      }

      .toc-level-3 a {
        grid-template-columns: 1rem 1fr;
        padding-left: 1.65rem;
        color: rgba(12, 12, 12, 0.56);
      }

      .toc-number,
      .toc-bullet {
        color: var(--firgun-green-dark);
      }

      .report {
        min-width: 0;
      }

      .chapter {
        position: relative;
        margin-bottom: 4.8rem;
        padding-top: 0.3rem;
        scroll-margin-top: 1rem;
      }

      .chapter::before {
        content: "";
        display: block;
        width: 100%;
        height: 1px;
        margin-bottom: 1.5rem;
        background: linear-gradient(90deg, var(--firgun-green), rgba(126, 159, 128, 0));
      }

      .chapter-head {
        display: grid;
        grid-template-columns: 74px minmax(0, 1fr);
        gap: 1rem;
        align-items: start;
        margin-bottom: 1.65rem;
      }

      .chapter-number {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 74px;
        aspect-ratio: 1 / 1;
        border-radius: 22px;
        background: rgba(195, 207, 197, 0.5);
        border: 1px solid rgba(12, 12, 12, 0.08);
        font-family: "Roboto", system-ui, sans-serif;
        font-size: 1.2rem;
        font-weight: 900;
        letter-spacing: -0.04em;
      }

      .chapter-kicker,
      .subsection-kicker {
        margin: 0 0 0.45rem;
        color: var(--firgun-green-dark);
        font-size: 0.9rem;
      }

      .chapter h2 {
        max-width: 18ch;
        font-size: clamp(2.1rem, 4vw, 3.2rem);
      }

      .chapter-body > * {
        max-width: var(--content-width);
      }

      .chapter-body p,
      .chapter-body li {
        font-size: 1.02rem;
        line-height: 1.78;
      }

      .chapter-body p {
        margin: 0 0 1.15rem;
      }

      .chapter-body strong {
        font-family: "Roboto", system-ui, sans-serif;
        font-weight: 700;
      }

      .chapter-body em {
        color: var(--firgun-green-dark);
      }

      .report-list {
        margin: 0 0 1.8rem;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 0.75rem;
      }

      .report-list li {
        position: relative;
        padding-left: 1.4rem;
      }

      .report-list li::before {
        content: "";
        position: absolute;
        left: 0.1rem;
        top: 0.72rem;
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 50%;
        background: var(--firgun-green-dark);
      }

      ol.report-list {
        counter-reset: report-count;
      }

      ol.report-list li::before {
        counter-increment: report-count;
        content: counter(report-count, decimal-leading-zero);
        width: auto;
        height: auto;
        top: 0.08rem;
        border-radius: 0;
        background: none;
        font-family: "Roboto", system-ui, sans-serif;
        font-size: 0.88rem;
        font-weight: 700;
        color: var(--firgun-green-dark);
      }

      .subsection {
        margin: 2.2rem 0 2.4rem;
        padding: 1.3rem 0 0;
        border-top: 1px solid var(--line);
        scroll-margin-top: 1rem;
      }

      .subsection h3 {
        margin-bottom: 1rem;
        font-size: clamp(1.45rem, 2.4vw, 2.15rem);
        line-height: 1.08;
      }

      .table-wrap {
        width: min(100%, calc(var(--content-width) + 130px));
        margin: 1.7rem 0 2.25rem;
        overflow-x: auto;
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid rgba(12, 12, 12, 0.08);
        box-shadow: var(--shadow);
      }

      table {
        width: 100%;
        min-width: 720px;
        border-collapse: collapse;
      }

      thead th {
        position: sticky;
        top: 0;
        background: var(--grey-green);
        font-family: "Roboto", system-ui, sans-serif;
        font-size: 0.9rem;
        line-height: 1.25;
        text-align: left;
      }

      th,
      td {
        padding: 1rem 1rem 0.95rem;
        border-bottom: 1px solid rgba(12, 12, 12, 0.08);
        vertical-align: top;
      }

      tbody tr:nth-child(even) td {
        background: rgba(225, 221, 212, 0.28);
      }

      tbody tr:last-child td {
        border-bottom: none;
      }

      .code-block,
      .timeline-block {
        width: min(100%, calc(var(--content-width) + 40px));
        margin: 1.8rem 0 2.4rem;
        border-radius: 28px;
        overflow: hidden;
        border: 1px solid rgba(12, 12, 12, 0.1);
        box-shadow: var(--shadow);
      }

      .code-block {
        background: var(--ink);
        color: var(--paper);
      }

      .code-label {
        padding: 0.8rem 1rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.76);
        font-size: 0.88rem;
      }

      pre {
        margin: 0;
        padding: 1.25rem 1.35rem 1.45rem;
        overflow-x: auto;
        font-size: 0.95rem;
        line-height: 1.65;
      }

      code {
        padding: 0.12rem 0.35rem;
        border-radius: 8px;
        background: rgba(12, 12, 12, 0.08);
        font-size: 0.92em;
      }

      .code-block code {
        background: none;
        padding: 0;
      }

      .timeline-block {
        background: rgba(255, 255, 255, 0.88);
      }

      .timeline-meta {
        padding: 1.1rem 1.2rem 0.6rem;
        border-bottom: 1px solid rgba(12, 12, 12, 0.08);
      }

      .timeline-label,
      .timeline-copy {
        margin: 0;
      }

      .timeline-label {
        color: var(--firgun-green-dark);
        font-size: 0.88rem;
      }

      .timeline-copy {
        margin-top: 0.35rem;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.55;
      }

      .timeline-groups {
        display: grid;
        gap: 0;
      }

      .timeline-group {
        padding: 1.1rem 1.2rem 1.2rem;
        border-bottom: 1px solid rgba(12, 12, 12, 0.08);
      }

      .timeline-group:last-child {
        border-bottom: none;
      }

      .timeline-group h4 {
        margin-bottom: 0.85rem;
        font-size: 1.2rem;
      }

      .timeline-row {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(132px, 0.45fr) minmax(132px, 0.35fr);
        gap: 0.9rem;
        padding: 0.68rem 0;
        border-top: 1px solid rgba(12, 12, 12, 0.06);
      }

      .timeline-row:first-of-type {
        border-top: none;
      }

      .timeline-task {
        font-size: 0.98rem;
        line-height: 1.6;
      }

      .timeline-date,
      .timeline-duration {
        color: var(--muted);
        font-size: 0.9rem;
      }

      .footer-note {
        max-width: var(--content-width);
        margin-top: 2rem;
        padding-top: 1.2rem;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.6;
      }

      .reveal {
        opacity: 0;
        transform: translateY(26px);
        transition: opacity 720ms ease, transform 720ms ease;
      }

      .reveal.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      @media (max-width: 1080px) {
        .hero-shell,
        .page-shell {
          grid-template-columns: 1fr;
        }

        .hero {
          min-height: auto;
          padding-top: 1.5rem;
        }

        .hero::after {
          width: min(56vw, 320px);
          right: 2rem;
          top: 6rem;
        }

        .hero-signal-plane {
          min-height: 420px;
        }

        .toc {
          position: relative;
          top: auto;
          padding: 0 0 1.2rem;
          border-left: none;
          border-bottom: 1px solid var(--line-strong);
        }

        .toc-list {
          grid-auto-flow: column;
          grid-auto-columns: minmax(200px, 1fr);
          overflow-x: auto;
          padding-bottom: 0.25rem;
        }
      }

      @media (max-width: 740px) {
        body {
          background-size: 52px 52px, 52px 52px, auto;
        }

        .hero,
        .page-shell {
          padding-left: 1rem;
          padding-right: 1rem;
        }

        .hero-metrics {
          grid-template-columns: 1fr;
        }

        .hero-signal-plane {
          min-height: auto;
        }

        .chapter-head {
          grid-template-columns: 1fr;
        }

        .chapter-number {
          width: 56px;
          border-radius: 18px;
        }

        table {
          min-width: 620px;
        }

        .timeline-row {
          grid-template-columns: 1fr;
          gap: 0.25rem;
        }
      }
    </style>
  </head>
  <body>
    <div class="progress" aria-hidden="true"><span id="progress-bar"></span></div>

    <header class="hero">
      <div class="hero-shell">
        <div class="hero-copy reveal is-visible">
          <div class="brand-lockup">
            <strong>FIRGUN</strong>
            <span>ventures</span>
          </div>
          <nav class="site-nav" aria-label="Related pages">
            <a href="linkedin-strategy.html">Proactive LinkedIn strategy</a>
          </nav>
          <p class="hero-kicker">Paid media strategy formatted in Firgun’s visual language</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="hero-summary">${escapeHtml(heroSummary)}</p>
          <div class="hero-metrics">
            ${heroMetrics
              .map(
                (metric) => `
                  <div class="hero-metric">
                    <strong>${escapeHtml(metric.value)}</strong>
                    <span>${escapeHtml(metric.label)}</span>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>

        <aside class="hero-signal-plane reveal is-visible" aria-label="Strategic posture">
          <div class="hero-signal-top">
            <p class="signal-label">Strategic posture</p>
            <p class="signal-title">Precision over volume</p>
          </div>
          <ul class="hero-signals">
            ${heroSignals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join("")}
          </ul>
        </aside>
      </div>
    </header>

    <div class="page-shell" id="report-start">
      <aside class="toc">
        <h2>Contents</h2>
        <p>Sticky navigation for the long-form report structure.</p>
        <ul class="toc-list">${toc}</ul>
      </aside>

      <main class="report">
        ${rendered}
        <p class="footer-note">
          This page was generated from the markdown report and restyled using Firgun’s documented visual identity:
          Roboto for headings, Courier Prime for body copy, a monochrome-first system, and Firgun Green / Grey Green / Sand as the primary layout palette.
        </p>
      </main>
    </div>

    <script>
      const progressBar = document.getElementById("progress-bar");
      const sections = Array.from(document.querySelectorAll(".chapter, .subsection"));
      const tocLinks = Array.from(document.querySelectorAll(".toc a[data-target]"));
      const revealItems = Array.from(document.querySelectorAll(".reveal"));

      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12 }
      );

      revealItems.forEach((item) => {
        if (!item.classList.contains("is-visible")) revealObserver.observe(item);
      });

      const sectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const id = entry.target.id;
            tocLinks.forEach((link) => {
              link.classList.toggle("is-active", link.dataset.target === id);
            });
          });
        },
        {
          rootMargin: "-20% 0px -60% 0px",
          threshold: 0.05,
        }
      );

      sections.forEach((section) => sectionObserver.observe(section));

      const updateProgress = () => {
        const scrollTop = window.scrollY;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const progress = maxScroll > 0 ? Math.min(scrollTop / maxScroll, 1) : 0;
        progressBar.style.width = (progress * 100).toFixed(2) + "%";
      };

      updateProgress();
      window.addEventListener("scroll", updateProgress, { passive: true });
      window.addEventListener("resize", updateProgress);
    </script>
  </body>
</html>`;
}

function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const rawMarkdown = fs.readFileSync(inputPath, "utf8");
  const stripped = stripResearchArtifacts(rawMarkdown);
  const tokens = parseMarkdown(stripped);
  const html = buildDocument(tokens, stripped);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf8");
  console.log(`Created ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}
