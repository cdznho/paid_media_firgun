"use strict";

const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("./layout");
const SHAPE = new PptxGenJS().ShapeType;

const FONTS = {
  heading: "Roboto",
  body: "Courier Prime",
  ui: "Roboto",
};

const COLORS = {
  black: "0C0C0C",
  white: "FFFFFF",
  firgunGreen: "7E9F80",
  firgunGreenDark: "4B5F4C",
  firgunGreenMid: "647E66",
  firgunGreenLight: "94B196",
  greyGreen: "C3CFC5",
  greyGreenDark: "747C76",
  greyGreenMid: "9BA59D",
  greyGreenLight: "DAE2DB",
  sand: "E1DDD4",
  sandDark: "87847F",
  sandMid: "B4B0A9",
  sandLight: "EDEAE4",
  text: "0C0C0C",
  muted: "747C76",
  line: "C3CFC5",
  panel: "FFFFFF",
  page: "EDEAE4",
};

const SLIDE = {
  width: 13.333,
  height: 7.5,
  left: 0.65,
  right: 0.65,
  top: 0.45,
  bottom: 0.35,
  titleY: 0.58,
  contentY: 1.42,
  contentH: 5.4,
  contentW: 12.033,
};

const args = process.argv.slice(2);
const defaultInput = path.resolve(__dirname, "..", "deep-research-report.md");
const inputPath = path.resolve(args[0] || defaultInput);
const outputPath = path.resolve(
  args[1] || inputPath.replace(/\.md$/i, ".pptx")
);

function cleanInline(text) {
  if (!text) return "";
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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
    .map((cell) => cleanInline(cell));
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
        text: cleanInline(headingMatch[2]),
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
      const headers = splitTableRow(tableLines[0]);
      const rows = tableLines
        .slice(2)
        .map((tableLine) => splitTableRow(tableLine))
        .filter((row) => row.some(Boolean));
      tokens.push({
        type: "table",
        headers,
        rows,
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
          const value = cleanInline(itemMatch[2]);
          items.push(value);
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
          items[items.length - 1] = cleanInline(
            `${items[items.length - 1]} ${rawTrimmed}`
          );
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
      text: cleanInline(paragraphLines.join(" ")),
    });
  }

  return tokens;
}

function guessClientName(markdown) {
  const match = markdown.match(/\n\n([A-Z][A-Za-z0-9&'.-]+)\s+is\b/);
  return match ? match[1] : "";
}

function titleCaseFromFilename(filename) {
  return filename
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildDeckTitle(tokens, markdown, inputFile) {
  const h1 = tokens.find((token) => token.type === "heading" && token.level === 1);
  const fallback = titleCaseFromFilename(path.basename(inputFile, path.extname(inputFile)));
  if (!h1) return fallback;
  if (/\bfor$/i.test(h1.text)) {
    const clientName = guessClientName(markdown);
    if (clientName) return `${h1.text} ${clientName}`;
  }
  return h1.text;
}

function paragraphToBullets(text) {
  if (!text) return [];
  const fragments = text
    .split(/(?<=[.!?])\s+|(?<=:)\s+(?=[A-Z])|;\s+/)
    .map((fragment) => cleanInline(fragment))
    .filter(Boolean);

  const bullets = [];
  let current = "";
  const maxLen = 170;
  for (const fragment of fragments) {
    if (!current) {
      current = fragment;
      continue;
    }
    if ((`${current} ${fragment}`).length <= maxLen) {
      current = `${current} ${fragment}`;
    } else {
      bullets.push(current);
      current = fragment;
    }
  }
  if (current) bullets.push(current);
  return bullets.length ? bullets : [text];
}

function buildTextRuns(items) {
  const runs = [];
  items.forEach((item, index) => {
    runs.push({
      text: item,
      options: {
        bullet: { indent: 16 },
        breakLine: index < items.length - 1,
      },
    });
  });
  return runs;
}

function chunkList(items, maxItems, maxChars) {
  const chunks = [];
  let current = [];
  let currentChars = 0;

  for (const item of items) {
    const nextLen = item.length;
    if (
      current.length &&
      (current.length >= maxItems || currentChars + nextLen > maxChars)
    ) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += nextLen;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function addBrandLockup(slide, x, y, align = "right") {
  slide.addText("FIRGUN", {
    x,
    y,
    w: 1.25,
    h: 0.14,
    fontFace: FONTS.heading,
    fontSize: 9.5,
    bold: true,
    color: COLORS.black,
    margin: 0,
    align,
  });
  slide.addText("ventures", {
    x,
    y: y + 0.16,
    w: 1.25,
    h: 0.14,
    fontFace: FONTS.body,
    fontSize: 7.8,
    color: COLORS.firgunGreenDark,
    margin: 0,
    align,
  });
}

function addGridFrame(slide) {
  slide.addShape(SHAPE.line, {
    x: 0.56,
    y: 0.36,
    w: 12.22,
    h: 0,
    line: { color: COLORS.greyGreen, width: 0.5, transparency: 25 },
  });
  slide.addShape(SHAPE.line, {
    x: 0.56,
    y: 6.98,
    w: 12.22,
    h: 0,
    line: { color: COLORS.greyGreen, width: 0.5, transparency: 25 },
  });
  slide.addShape(SHAPE.line, {
    x: 0.56,
    y: 0.36,
    w: 0,
    h: 6.62,
    line: { color: COLORS.greyGreen, width: 0.35, transparency: 35 },
  });
  slide.addShape(SHAPE.line, {
    x: 12.78,
    y: 0.36,
    w: 0,
    h: 6.62,
    line: { color: COLORS.greyGreen, width: 0.35, transparency: 35 },
  });
  slide.addShape(SHAPE.line, {
    x: 10.92,
    y: 0.36,
    w: 0,
    h: 6.62,
    line: { color: COLORS.greyGreen, width: 0.35, transparency: 55 },
  });
}

function addHalftoneCluster(
  slide,
  x,
  y,
  {
    cols = 6,
    rows = 5,
    size = 0.08,
    gap = 0.05,
    color = COLORS.greyGreenDark,
    transparency = 55,
  } = {}
) {
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const alpha = Math.max(8, transparency + row * 4 + col * 2);
      slide.addShape(SHAPE.ellipse, {
        x: x + col * (size + gap),
        y: y + row * (size + gap),
        w: size,
        h: size,
        line: { color, transparency: 100 },
        fill: { color, transparency: alpha },
      });
    }
  }
}

function addContentPanel(
  slide,
  {
    x,
    y,
    w,
    h,
    fill = COLORS.panel,
    border = COLORS.line,
    accent = COLORS.firgunGreen,
    radius = 0.05,
  }
) {
  slide.addShape(SHAPE.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: radius,
    line: { color: border, width: 1 },
    fill: { color: fill },
  });
  slide.addShape(SHAPE.rect, {
    x: x + 0.16,
    y: y + 0.22,
    w: 0.08,
    h: h - 0.44,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  });
}

function addSlideChrome(slide, title, eyebrow, footer) {
  slide.background = { color: COLORS.page };
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 0,
    w: SLIDE.width,
    h: SLIDE.height,
    line: { color: COLORS.page, transparency: 100 },
    fill: { color: COLORS.page },
  });
  addGridFrame(slide);
  addHalftoneCluster(slide, 10.18, 0.5, {
    cols: 4,
    rows: 3,
    size: 0.07,
    gap: 0.05,
    color: COLORS.firgunGreenDark,
    transparency: 72,
  });
  addBrandLockup(slide, 11.18, 0.44);
  if (eyebrow) {
    slide.addText(eyebrow, {
      x: SLIDE.left,
      y: 0.56,
      w: 5.7,
      h: 0.18,
      fontFace: FONTS.body,
      fontSize: 9.2,
      bold: true,
      color: COLORS.firgunGreenDark,
      margin: 0,
    });
  }
  slide.addText(title, {
    x: SLIDE.left,
    y: 0.82,
    w: 11.2,
    h: 0.52,
    fontFace: FONTS.heading,
    fontSize: 22,
    bold: true,
    color: COLORS.black,
    margin: 0,
  });
  slide.addShape(SHAPE.line, {
    x: SLIDE.left,
    y: 1.16,
    w: 3.35,
    h: 0,
    line: { color: COLORS.firgunGreen, width: 1.25 },
  });
  slide.addText(footer, {
    x: SLIDE.left,
    y: 7.06,
    w: 5.2,
    h: 0.16,
    fontFace: FONTS.body,
    fontSize: 8,
    color: COLORS.muted,
    margin: 0,
  });
}

function finalizeSlide(slide, pptx) {
  warnIfSlideHasOverlaps(slide, pptx, {
    muteContainment: true,
    ignoreDecorativeShapes: true,
  });
  const hasTableObject = Array.isArray(slide._slideObjects)
    ? slide._slideObjects.some((obj) => {
        const payload = obj.data || obj.options || {};
        return (
          obj._type === "table" ||
          obj.type === "table" ||
          Array.isArray(obj.arrTabRows) ||
          Array.isArray(payload.rows) ||
          Array.isArray(payload.table)
        );
      })
    : false;
  if (!hasTableObject) {
    warnIfSlideElementsOutOfBounds(slide, pptx);
  }
}

function addTitleSlide(pptx, deckTitle, inputFile) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.page };
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 0,
    w: SLIDE.width,
    h: SLIDE.height,
    line: { color: COLORS.page, transparency: 100 },
    fill: { color: COLORS.page },
  });
  addGridFrame(slide);
  addBrandLockup(slide, 0.8, 0.52, "left");
  slide.addShape(SHAPE.rect, {
    x: 8.3,
    y: 0.84,
    w: 4.2,
    h: 5.7,
    line: { color: COLORS.sand, transparency: 100 },
    fill: { color: COLORS.sand },
  });
  addHalftoneCluster(slide, 11.96, 1.04, {
    cols: 4,
    rows: 5,
    size: 0.085,
    gap: 0.055,
    color: COLORS.firgunGreenDark,
    transparency: 70,
  });
  addContentPanel(slide, {
    x: 8.75,
    y: 1.36,
    w: 3.08,
    h: 4.65,
    fill: COLORS.white,
    border: COLORS.greyGreen,
    accent: COLORS.black,
    radius: 0.05,
  });
  slide.addText(deckTitle, {
    x: 0.8,
    y: 1.46,
    w: 6.55,
    h: 1.45,
    fontFace: FONTS.heading,
    fontSize: 28,
    bold: true,
    color: COLORS.black,
    margin: 0,
    valign: "mid",
  });
  slide.addShape(SHAPE.line, {
    x: 0.8,
    y: 1.16,
    w: 2.8,
    h: 0,
    line: { color: COLORS.firgunGreen, width: 1.2 },
  });
  slide.addText("Research report reformatted for presentation use and aligned to the Firgun visual identity system.", {
    x: 0.8,
    y: 3.0,
    w: 5.95,
    h: 0.7,
    fontFace: FONTS.body,
    fontSize: 13.2,
    color: COLORS.black,
    margin: 0,
    valign: "mid",
  });
  slide.addText(`Source file: ${path.basename(inputFile)}`, {
    x: 0.8,
    y: 6.74,
    w: 4.8,
    h: 0.2,
    fontFace: FONTS.body,
    fontSize: 8.2,
    color: COLORS.muted,
    margin: 0,
  });
  slide.addText(
    [
      {
        text: "Deck structure",
        options: { breakLine: true, bold: true, color: COLORS.black },
      },
      {
        text:
          "Executive summary, funnel architecture, personas, channels, measurement, creative, and a 90-day launch plan.",
        options: { breakLine: true, color: COLORS.black },
      },
      {
        text: "Formatting choices",
        options: { breakLine: true, bold: true, color: COLORS.black },
      },
      {
        text:
          "Research citations were removed from slide copy, and dense tables were split across multiple slides for readability.",
        options: { color: COLORS.black },
      },
    ],
    {
      x: 9.12,
      y: 1.72,
      w: 2.36,
      h: 3.95,
      fontFace: FONTS.body,
      fontSize: 11.1,
      margin: 0,
      breakLine: false,
      valign: "top",
      paraSpaceAfterPt: 12,
    }
  );
  finalizeSlide(slide, pptx);
}

function addSectionSlide(pptx, sectionTitle, inputFile) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.page };
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 0,
    w: SLIDE.width,
    h: SLIDE.height,
    line: { color: COLORS.page, transparency: 100 },
    fill: { color: COLORS.page },
  });
  addGridFrame(slide);
  addBrandLockup(slide, 11.18, 0.44);
  addContentPanel(slide, {
    x: 0.82,
    y: 1.5,
    w: 3.05,
    h: 4.55,
    fill: COLORS.black,
    border: COLORS.black,
    accent: COLORS.firgunGreen,
    radius: 0.05,
  });
  addHalftoneCluster(slide, 1.28, 3.35, {
    cols: 6,
    rows: 5,
    size: 0.09,
    gap: 0.055,
    color: COLORS.greyGreen,
    transparency: 72,
  });
  slide.addText("Section Break", {
    x: 1.08,
    y: 1.84,
    w: 1.8,
    h: 0.22,
    fontFace: FONTS.body,
    fontSize: 10,
    bold: true,
    color: COLORS.sand,
    margin: 0,
  });
  slide.addText(sectionTitle, {
    x: 4.46,
    y: 2.18,
    w: 7.25,
    h: 1.4,
    fontFace: FONTS.heading,
    fontSize: 29,
    bold: true,
    color: COLORS.black,
    margin: 0,
    valign: "mid",
  });
  slide.addText("Firgun visual identity applied across typography, palette, framing, and graphic accents.", {
    x: 4.46,
    y: 3.72,
    w: 5.6,
    h: 0.72,
    fontFace: FONTS.body,
    fontSize: 12.2,
    color: COLORS.black,
    margin: 0,
    valign: "mid",
  });
  slide.addShape(SHAPE.line, {
    x: 4.46,
    y: 1.76,
    w: 2.7,
    h: 0,
    line: { color: COLORS.firgunGreen, width: 1.2 },
  });
  slide.addText(`Source: ${path.basename(inputFile)}`, {
    x: 4.46,
    y: 6.92,
    w: 3.6,
    h: 0.18,
    fontFace: FONTS.body,
    fontSize: 8,
    color: COLORS.muted,
    margin: 0,
  });
  slide.addText("Structure as a frame; leaving room to breathe.", {
    x: 1.08,
    y: 5.56,
    w: 2.3,
    h: 0.3,
    fontFace: FONTS.body,
    fontSize: 9.2,
    bold: true,
    color: COLORS.white,
    margin: 0,
  });
  finalizeSlide(slide, pptx);
}

function addBulletSlides(pptx, title, eyebrow, items, footer) {
  const chunks = chunkList(items, 6, 760);
  chunks.forEach((chunk, index) => {
    const slide = pptx.addSlide();
    const slideTitle =
      chunks.length > 1 ? `${title} (${index + 1}/${chunks.length})` : title;
    addSlideChrome(slide, slideTitle, eyebrow, footer);
    addContentPanel(slide, {
      x: 0.78,
      y: 1.46,
      w: 11.78,
      h: 5.43,
      fill: COLORS.white,
      border: COLORS.greyGreen,
      accent:
        index % 2 === 0 ? COLORS.firgunGreen : COLORS.greyGreenDark,
      radius: 0.05,
    });
    slide.addText(buildTextRuns(chunk), {
      x: 1.14,
      y: 1.74,
      w: 10.96,
      h: 4.75,
      fontFace: FONTS.body,
      fontSize: 14.7,
      color: COLORS.text,
      margin: 0,
      paraSpaceAfterPt: 8,
      valign: "top",
      breakLine: false,
    });
    slide.addShape(SHAPE.line, {
      x: 1.14,
      y: 1.58,
      w: 1.2,
      h: 0,
      line: { color: COLORS.black, width: 0.8 },
    });
    finalizeSlide(slide, pptx);
  });
}

function averageCellLength(headers, rows) {
  const cells = [headers, ...rows].flat().filter(Boolean);
  if (!cells.length) return 0;
  return cells.join("").length / cells.length;
}

function computeColumnWindows(headers, maxColumns) {
  if (headers.length <= maxColumns) {
    return [headers.map((_, index) => index)];
  }
  const windows = [];
  windows.push(headers.slice(0, maxColumns).map((_, index) => index));
  let start = maxColumns;
  while (start < headers.length) {
    const window = [0];
    for (let i = start; i < Math.min(start + maxColumns - 1, headers.length); i += 1) {
      window.push(i);
    }
    windows.push(window);
    start += maxColumns - 1;
  }
  return windows;
}

function pickRowChunkSize(headers, rows) {
  const avgLen = averageCellLength(headers, rows);
  if (headers.length >= 5 || avgLen > 80) return 3;
  if (avgLen > 45) return 4;
  return 5;
}

function buildColumnWidths(columnCount) {
  if (columnCount === 2) return [2.5, 9.2];
  if (columnCount === 3) return [2.2, 4.8, 4.7];
  if (columnCount === 4) return [1.7, 3.4, 3.4, 3.5];
  return [1.6, 2.55, 2.55, 2.55, 2.55];
}

function chunkRows(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

function addTableSlides(pptx, title, eyebrow, headers, rows, footer) {
  const windows = computeColumnWindows(headers, 5);
  const rowChunkSize = pickRowChunkSize(headers, rows);
  const avgLen = averageCellLength(headers, rows);
  const fontSize = headers.length >= 5 || avgLen > 60 ? 8.5 : avgLen > 40 ? 9.5 : 10.5;

  windows.forEach((window, windowIndex) => {
    const windowHeaders = window.map((index) => headers[index]);
    const windowRows = rows.map((row) =>
      window.map((index) => cleanInline(row[index] || ""))
    );
    const rowChunks = chunkRows(windowRows, rowChunkSize);

    rowChunks.forEach((rowChunk, chunkIndex) => {
      const slide = pptx.addSlide();
      const parts = [];
      if (windows.length > 1) parts.push(`Cols ${windowIndex + 1}/${windows.length}`);
      if (rowChunks.length > 1) parts.push(`Rows ${chunkIndex + 1}/${rowChunks.length}`);
      const suffix = parts.length ? ` (${parts.join(" | ")})` : "";
      addSlideChrome(slide, `${title}${suffix}`, eyebrow, footer);
      addContentPanel(slide, {
        x: 0.78,
        y: 1.42,
        w: 11.78,
        h: 5.5,
        fill: COLORS.white,
        border: COLORS.greyGreen,
        accent: COLORS.firgunGreen,
        radius: 0.05,
      });
      const tableRows = [windowHeaders, ...rowChunk];
      slide.addTable(tableRows, {
        x: 0.98,
        y: 1.7,
        w: 11.34,
        h: 4.88,
        colW: buildColumnWidths(windowHeaders.length),
        margin: 0.08,
        border: { type: "solid", color: COLORS.greyGreen, width: 0.75 },
        fontFace: FONTS.ui,
        fontSize,
        color: COLORS.text,
        fill: COLORS.white,
        valign: "mid",
        bold: false,
        autoPage: false,
        rowH: 0.54,
        autoFit: false,
        paraSpaceAfterPt: 4,
        breakLine: false,
        theme: {
          headFontFace: FONTS.ui,
          bodyFontFace: FONTS.ui,
        },
        cellProps: tableRows.map((row, rowIndex) =>
          row.map((_, cellIndex) =>
            rowIndex === 0
              ? {
                  fill: { color: COLORS.greyGreen },
                  color: COLORS.black,
                  bold: true,
                  fontSize: fontSize + 0.3,
                }
              : {
                  fill: {
                    color:
                      rowIndex % 2 === 0 ? COLORS.sandLight : COLORS.white,
                  },
                  color: COLORS.black,
                  bold: cellIndex === 0,
                }
          )
        ),
      });
      finalizeSlide(slide, pptx);
    });
  });
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
    const task = cleanInline(trimmed.slice(0, separatorIndex));
    const timing = trimmed
      .slice(separatorIndex + 1)
      .split(",")
      .map((part) => cleanInline(part));
    rows.push([
      currentSection,
      task,
      timing[1] || "",
      timing[2] || "",
    ]);
  });
  return {
    headers: ["Phase", "Task", "Start", "Duration"],
    rows,
  };
}

function addCodeSlides(pptx, title, eyebrow, lang, content, footer) {
  if (lang === "mermaid" && /\bgantt\b/.test(content)) {
    const ganttTable = parseMermaidGantt(content);
    addTableSlides(pptx, title, eyebrow, ganttTable.headers, ganttTable.rows, footer);
    return;
  }

  const lines = content.split("\n");
  const chunks = [];
  for (let i = 0; i < lines.length; i += 12) {
    chunks.push(lines.slice(i, i + 12));
  }

  chunks.forEach((chunk, index) => {
    const slide = pptx.addSlide();
    const slideTitle =
      chunks.length > 1 ? `${title} (${index + 1}/${chunks.length})` : title;
    addSlideChrome(slide, slideTitle, eyebrow, footer);
    addContentPanel(slide, {
      x: 0.78,
      y: 1.44,
      w: 11.78,
      h: 5.44,
      fill: COLORS.black,
      border: COLORS.black,
      accent: COLORS.firgunGreen,
      radius: 0.05,
    });
    slide.addText(chunk.join("\n"), {
      x: 1.14,
      y: 1.74,
      w: 10.98,
      h: 4.72,
      fontFace: FONTS.body,
      fontSize: 12.5,
      color: COLORS.white,
      margin: 0,
      breakLine: false,
      valign: "top",
    });
    finalizeSlide(slide, pptx);
  });
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input markdown file not found: ${inputPath}`);
  }

  const rawMarkdown = fs.readFileSync(inputPath, "utf8");
  const strippedMarkdown = stripResearchArtifacts(rawMarkdown);
  const tokens = parseMarkdown(strippedMarkdown);
  const deckTitle = buildDeckTitle(tokens, strippedMarkdown, inputPath);
  const footer = `Source: ${path.basename(inputPath)}`;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "OpenAI";
  pptx.subject = deckTitle;
  pptx.title = deckTitle;
  pptx.lang = "en-GB";
  pptx.theme = {
    headFontFace: FONTS.heading,
    bodyFontFace: FONTS.body,
    lang: "en-GB",
  };

  addTitleSlide(pptx, deckTitle, inputPath);

  let currentH2 = "";
  let currentH3 = "";
  let pendingBullets = [];

  function flushPendingBullets() {
    if (!pendingBullets.length) return;
    const activeTitle = currentH3 || currentH2 || deckTitle;
    const eyebrow = currentH3 ? currentH2 : "Report Content";
    addBulletSlides(pptx, activeTitle, eyebrow, pendingBullets, footer);
    pendingBullets = [];
  }

  tokens.forEach((token) => {
    if (token.type === "heading") {
      flushPendingBullets();
      if (token.level === 1) return;
      if (token.level === 2) {
        currentH2 = token.text;
        currentH3 = "";
        addSectionSlide(pptx, currentH2, inputPath);
        return;
      }
      if (token.level === 3) {
        currentH3 = token.text;
      }
      return;
    }

    if (token.type === "paragraph") {
      pendingBullets.push(...paragraphToBullets(token.text));
      return;
    }

    if (token.type === "list") {
      const listItems = token.items.map((item, index) =>
        token.ordered ? `${index + 1}. ${item}` : item
      );
      pendingBullets.push(...listItems);
      return;
    }

    if (token.type === "table") {
      flushPendingBullets();
      const activeTitle = currentH3 || currentH2 || deckTitle;
      const eyebrow = currentH3 ? currentH2 : "Report Table";
      addTableSlides(pptx, activeTitle, eyebrow, token.headers, token.rows, footer);
      return;
    }

    if (token.type === "code") {
      flushPendingBullets();
      const activeTitle = currentH3 || currentH2 || deckTitle;
      const eyebrow = currentH3 ? currentH2 : "Report Appendix";
      addCodeSlides(pptx, activeTitle, eyebrow, token.lang, token.content, footer);
    }
  });

  flushPendingBullets();

  await pptx.writeFile({ fileName: outputPath, compression: true });
  console.log(`Created ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
