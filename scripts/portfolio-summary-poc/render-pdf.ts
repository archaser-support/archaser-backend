/**
 * Portfolio summary POC — print the Hebrew markdown draft to an RTL PDF.
 *
 * Charts come from the data bundle. The narrative is the draft written by the
 * review loop, using the chapters in the portfolio-summary PRD. Output stays
 * in the gitignored `.scratch/portfolio-summary-poc/`.
 *
 * Uses the Playwright already installed in the frontend repo. Does not download
 * a browser.
 *
 *   npx tsx --tsconfig api/tsconfig.json scripts/portfolio-summary-poc/render-pdf.ts
 */
import "dotenv/config";
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";

import { lastReportRange } from "./report-range";

const OUTPUT_DIR = path.resolve(__dirname, "../../.scratch/portfolio-summary-poc");
const DEFAULT_ACCOUNT = 10149;
const defaultRange = lastReportRange();
const DEFAULT_DRAFT = path.join(
    OUTPUT_DIR,
    `draft-${DEFAULT_ACCOUNT}-${defaultRange.from}_${defaultRange.to}.md`
);
const DEFAULT_BUNDLE = path.join(
    OUTPUT_DIR,
    `bundle-${DEFAULT_ACCOUNT}-${defaultRange.from}_${defaultRange.to}.json`
);
const DEFAULT_PDF = path.join(
    OUTPUT_DIR,
    `summary-${DEFAULT_ACCOUNT}-${defaultRange.from}_${defaultRange.to}.pdf`
);
const LOGO = path.resolve(
    __dirname,
    "../../../frontend/public/assets/images/brand-logos/logo.png"
);

/** Visual system of the half-year portfolio PDF: purple banner, numbered chapters, KPI row. */
const INK = "#101828";
const MUTED = "#667085";
const LINE = "#EAECF0";
const SURFACE = "#F8F9FC";
const COMPLIANT = "#0F9D74";
const AT_RISK = "#C2703A";
const ACCENT = "#6D4AFF";
const CHART_BLUE = "#3B6FE0";
const RISK = "#D92D20";
/** Same figure as PORTFOLIO_HEALTH_BELOW_THRESHOLD_PCT. A reference line, not a policy term. */
const HEALTH_REFERENCE_PCT = 85;

const MONTHS = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];

type DailyHealth = {
    snapshotDate: string;
    healthIndex: number;
    compliantExposure: number;
    atRiskExposure: number;
};
type MonthlyAr = {
    month: string;
    compliantExposure: number;
    atRiskExposure: number;
};
type DailyUtil = { snapshotDate: string; utilizationPct: number };
type MonthlyCost = {
    month: string;
    totalCost: number;
    insuranceCost?: number;
    registrationFeeCost?: number;
    topUpCost?: number;
};
type ReportRange = { from: string; to: string };

type BundleCharts = {
    dailyHealth: DailyHealth[];
    monthlyAr: MonthlyAr[];
    dailyUtil: DailyUtil[];
    monthlyCost: MonthlyCost[];
};

type Block =
    | { kind: "h1"; html: string }
    | { kind: "h2"; html: string; text: string }
    | { kind: "p"; html: string; text: string }
    | { kind: "ul"; html: string }
    | { kind: "ol"; items: string[] }
    | { kind: "table"; rows: string[][] }
    | { kind: "chart"; html: string };

function readFlag(argv: string[], name: string): string | undefined {
    const index = argv.indexOf(name);
    if (index === -1) {
        return undefined;
    }
    const value = argv[index + 1];
    return value != null && !value.startsWith("--") ? value : undefined;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function inline(value: string): string {
    return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function monthLabel(month: string): string {
    const part = Number(month.slice(5, 7));
    return MONTHS[part - 1] ?? month;
}

function monthEnd(month: string): string {
    const [year, monthNumber] = month.split("-").map(Number);
    const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return `${month}-${String(last).padStart(2, "0")}`;
}

function isPartialMonth(month: string, range: ReportRange): boolean {
    if (!range.from || !range.to) {
        return false;
    }
    const start = `${month}-01`;
    const end = monthEnd(month);
    return (
        (range.from > start && range.from.slice(0, 7) === month) ||
        (range.to < end && range.to.slice(0, 7) === month)
    );
}

function axisLabel(month: string, range: ReportRange): string {
    const label = monthLabel(month);
    return isPartialMonth(month, range) ? `${label}*` : label;
}

function partialCaption(months: string[], range: ReportRange): string {
    return months.some((month) => isPartialMonth(month, range)) ? " · * חודש חלקי" : "";
}

function niceMax(value: number): number {
    if (value <= 0) {
        return 1;
    }
    const pow = Math.pow(10, Math.floor(Math.log10(value)));
    const step = value / pow > 5 ? pow : value / pow > 2 ? pow / 2 : pow / 5;
    return Math.ceil(value / step) * step;
}

function svgText(
    x: number,
    y: number,
    text: string,
    anchor: "start" | "middle" | "end" = "middle",
    fill = MUTED
): string {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" direction="ltr" fill="${fill}" font-size="9" font-family="Arial, sans-serif">${escapeHtml(text)}</text>`;
}

function legend(items: Array<{ color: string; label: string; dashed?: boolean }>): string {
    const marks = items
        .map((item) => {
            const style = item.dashed
                ? `background:transparent;border-top:1.5px dashed ${item.color}`
                : `background:${item.color}`;
            return `<span><i style="${style}"></i>${escapeHtml(item.label)}</span>`;
        })
        .join("");
    return `<div class="legend">${marks}</div>`;
}

function lineChart(
    points: Array<{ label: string; value: number }>,
    opts: {
        color: string;
        min: number;
        max: number;
        format: (n: number) => string;
        reference?: { value: number; label: string };
    }
): string {
    const width = 520;
    const height = 128;
    const left = 10;
    const right = 34;
    const top = 16;
    const bottom = 18;
    const innerW = width - left - right;
    const innerH = height - top - bottom;
    const span = opts.max - opts.min || 1;
    const yOf = (value: number) => top + innerH - ((value - opts.min) / span) * innerH;
    const coords = points.map((point, index) => {
        const x = left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
        return { x, y: yOf(point.value), label: point.label };
    });
    const poly = coords.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const ticks = [opts.min, (opts.min + opts.max) / 2, opts.max];
    const axisX = width - right;
    const grid = ticks
        .map((tick) => {
            const y = yOf(tick);
            return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${axisX}" y2="${y.toFixed(1)}" stroke="${LINE}" />${svgText(width - 4, Math.max(y, 11) + 3, opts.format(tick), "end")}`;
        })
        .join("");
    const labels = coords
        .filter((point) => point.label)
        .map((point) => svgText(point.x, height - 4, point.label))
        .join("");
    const reference =
        opts.reference == null
            ? ""
            : `<line x1="${left}" y1="${yOf(opts.reference.value).toFixed(1)}" x2="${axisX}" y2="${yOf(opts.reference.value).toFixed(1)}" stroke="${MUTED}" stroke-dasharray="4 3" />${svgText(left, Math.max(11, yOf(opts.reference.value) - 3), opts.reference.label, "start", MUTED)}`;
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${grid}${reference}<polyline fill="none" stroke="${opts.color}" stroke-width="1.8" points="${poly}" />${labels}</svg>`;
}

function barValue(x: number, y: number, barHeight: number, barWidth: number, text: string): string {
    if (text === "" || barHeight <= 0) {
        return "";
    }
    const centerX = x + barWidth / 2;
    const inside = barHeight >= 12;
    const centerY = inside ? y + barHeight / 2 + 3 : Math.max(9, y - 1);
    const fill = inside ? "#FFFFFF" : "#101828";
    return `<text x="${centerX.toFixed(1)}" y="${centerY.toFixed(1)}" text-anchor="middle" fill="${fill}" font-size="8" font-weight="700" font-family="Arial, sans-serif">${escapeHtml(text)}</text>`;
}

function millionsLabel(value: number): string {
    if (value <= 0) {
        return "";
    }
    const millions = value / 1_000_000;
    return millions >= 10 ? millions.toFixed(0) : millions.toFixed(1);
}

function stackedBars(
    rows: Array<{ label: string; compliant: number; atRisk: number }>
): string {
    const width = 520;
    const height = 168;
    const left = 10;
    const right = 40;
    const top = 16;
    const bottom = 18;
    const innerW = width - left - right;
    const innerH = height - top - bottom;
    const max = niceMax(Math.max(...rows.map((row) => row.compliant + row.atRisk), 0));
    const gap = 8;
    const barW = rows.length === 0 ? 0 : (innerW - gap * (rows.length - 1)) / rows.length;
    const ticks = [0, max / 2, max];
    const axisX = width - right;
    const grid = ticks
        .map((tick) => {
            const y = top + innerH - (tick / max) * innerH;
            const millions = tick / 1_000_000;
            const label = millions >= 10 ? millions.toFixed(0) : millions.toFixed(1);
            return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${axisX}" y2="${y.toFixed(1)}" stroke="${LINE}" />${svgText(width - 4, Math.max(y, 11) + 3, label, "end")}`;
        })
        .join("");
    const bars = rows
        .map((row, index) => {
            const x = left + index * (barW + gap);
            const riskH = (row.atRisk / max) * innerH;
            const okH = (row.compliant / max) * innerH;
            const riskY = top + innerH - riskH;
            const okY = riskY - okH;
            return `<rect x="${x.toFixed(1)}" y="${okY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(okH, 0).toFixed(1)}" fill="${COMPLIANT}" />${barValue(x, okY, okH, barW, millionsLabel(row.compliant))}<rect x="${x.toFixed(1)}" y="${riskY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(riskH, 0).toFixed(1)}" fill="${AT_RISK}" />${barValue(x, riskY, riskH, barW, millionsLabel(row.atRisk))}${svgText(x + barW / 2, height - 4, row.label)}`;
        })
        .join("");
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${grid}${bars}</svg>`;
}

function costBars(
    rows: Array<{ label: string; premium: number; registration: number; topUp: number }>
): string {
    const width = 520;
    const height = 168;
    const left = 10;
    const right = 40;
    const top = 16;
    const bottom = 18;
    const innerW = width - left - right;
    const innerH = height - top - bottom;
    const max = niceMax(
        Math.max(...rows.map((row) => row.premium + row.registration + row.topUp), 0)
    );
    const gap = 8;
    const barW = rows.length === 0 ? 0 : (innerW - gap * (rows.length - 1)) / rows.length;
    const ticks = [0, max / 2, max];
    const axisX = width - right;
    const thousands = (value: number) => {
        const rounded = Math.round(value / 1000);
        return rounded > 0 ? String(rounded) : "";
    };
    const grid = ticks
        .map((tick) => {
            const y = top + innerH - (tick / max) * innerH;
            return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${axisX}" y2="${y.toFixed(1)}" stroke="${LINE}" />${svgText(width - 4, Math.max(y, 11) + 3, `${Math.round(tick / 1000)}`, "end")}`;
        })
        .join("");
    const bars = rows
        .map((row, index) => {
            const x = left + index * (barW + gap);
            const parts = [
                { value: row.premium, color: ACCENT },
                { value: row.registration, color: CHART_BLUE },
                { value: row.topUp, color: AT_RISK },
            ];
            let y = top + innerH;
            const segments = parts
                .map((part) => {
                    const h = max > 0 ? (part.value / max) * innerH : 0;
                    y -= h;
                    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" fill="${part.color}" />${barValue(x, y, h, barW, thousands(part.value))}`;
                })
                .join("");
            return `${segments}${svgText(x + barW / 2, height - 4, row.label)}`;
        })
        .join("");
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${grid}${bars}</svg>`;
}

function chartHtml(kind: string, charts: BundleCharts, range: ReportRange): string {
    if (kind.includes("רמת הגנה")) {
        const points = charts.dailyHealth.map((row) => ({
            label: row.snapshotDate.slice(8, 10) === "01" ? monthLabel(row.snapshotDate.slice(0, 7)) : "",
            value: row.healthIndex,
        }));
        if (points.length === 0) {
            return "";
        }
        const low = Math.min(...points.map((point) => point.value), HEALTH_REFERENCE_PCT);
        const high = Math.max(...points.map((point) => point.value), HEALTH_REFERENCE_PCT);
        const min = Math.max(0, Math.floor((low - 4) / 5) * 5);
        const max = Math.min(100, Math.ceil((high + 4) / 5) * 5);
        const svg = lineChart(points, {
            color: CHART_BLUE,
            min,
            max,
            format: (n) => n.toFixed(0),
            reference: { value: HEALTH_REFERENCE_PCT, label: `${HEALTH_REFERENCE_PCT}%` },
        });
        return `<figure><figcaption>רמת הגנה יומית (%)</figcaption>${svg}${legend([
            { color: CHART_BLUE, label: "רמת הגנה" },
            { color: MUTED, label: `${HEALTH_REFERENCE_PCT}%`, dashed: true },
        ])}</figure>`;
    }
    if (kind.includes("חשיפה")) {
        const rows = charts.monthlyAr.map((row) => ({
            label: axisLabel(row.month, range),
            compliant: row.compliantExposure,
            atRisk: row.atRiskExposure,
        }));
        const note = partialCaption(
            charts.monthlyAr.map((row) => row.month),
            range
        );
        return `<figure><figcaption>חשיפה תקינה מול חשיפה בסיכון, מיליוני ₪${note}</figcaption>${stackedBars(rows)}${legend([
            { color: COMPLIANT, label: "חשיפה תקינה" },
            { color: AT_RISK, label: "חשיפה בסיכון" },
        ])}</figure>`;
    }
    if (kind.includes("ניצול")) {
        const points = charts.dailyUtil.map((row) => ({
            label: row.snapshotDate.slice(8, 10) === "01" ? monthLabel(row.snapshotDate.slice(0, 7)) : "",
            value: row.utilizationPct,
        }));
        return `<figure><figcaption>ניצול יומי (%)</figcaption>${lineChart(points, {
            color: ACCENT,
            min: 0,
            max: 100,
            format: (n) => n.toFixed(0),
        })}${legend([{ color: ACCENT, label: "ניצול" }])}</figure>`;
    }
    if (kind.includes("עלות")) {
        const rows = charts.monthlyCost.map((row) => ({
            label: axisLabel(row.month, range),
            premium: row.insuranceCost ?? 0,
            registration: row.registrationFeeCost ?? 0,
            topUp: row.topUpCost ?? 0,
        }));
        const note = partialCaption(
            charts.monthlyCost.map((row) => row.month),
            range
        );
        return `<figure><figcaption>עלות פוליסה חודשית, אלפי ₪${note}</figcaption>${costBars(rows)}${legend([
            { color: ACCENT, label: "פרמיה" },
            { color: CHART_BLUE, label: "דמי רישום" },
            { color: AT_RISK, label: "כיסוי עילי" },
        ])}</figure>`;
    }
    return "";
}

function recommendedTermDays(text: string): number | null {
    const pattern = /(?<!לא\s)לבקש(?:\s+[^\d,.\s]+){0,4}\s+(\d+)\s+ימ/g;
    let found: number | null = null;
    for (const match of text.matchAll(pattern)) {
        found = Number(match[1]);
    }
    return found;
}

function cellNumber(cell: string): number | null {
    const match = cell.match(/\d+/);
    return match ? Number(match[0]) : null;
}

function tableHtml(rows: string[][], context: string): string {
    const [head, ...body] = rows;
    const pick = recommendedTermDays(context);
    const headHtml = (head ?? []).map((cell) => `<th>${inline(cell)}</th>`).join("");
    const bodyHtml = body
        .map((row) => {
            const picked = pick != null && cellNumber(row[0] ?? "") === pick;
            const cells = row.map((cell) => `<td>${inline(cell)}</td>`).join("");
            return `<tr${picked ? ' class="pick"' : ""}>${cells}</tr>`;
        })
        .join("");
    return `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

function splitAction(raw: string): { title: string; evidence: string; action: string } {
    const titleMatch = raw.match(/^\*\*(.+?)\*\*\s*/);
    const title = titleMatch?.[1] ?? "";
    const rest = titleMatch ? raw.slice(titleMatch[0].length) : raw;
    const sentences = rest.split(/(?<=\.)\s+/).filter(Boolean);
    const actionStart = sentences.findIndex((sentence) => /^ל[\u0590-\u05FF]/.test(sentence.trim()));
    if (actionStart === -1) {
        return { title, evidence: rest, action: "" };
    }
    return {
        title,
        evidence: sentences.slice(0, actionStart).join(" "),
        action: sentences.slice(actionStart).join(" "),
    };
}

function actionTable(items: string[]): string {
    const rows = items
        .map((item, index) => {
            const parts = splitAction(item);
            return `<tr><td class="num">${index + 1}</td><td class="priority">${inline(parts.title || item)}</td><td>${inline(parts.evidence)}</td><td>${inline(parts.action)}</td></tr>`;
        })
        .join("");
    return `<table class="actions"><thead><tr><th>#</th><th>עדיפות</th><th>ראיה</th><th>המלצה</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function parseMarkdown(markdown: string, charts: BundleCharts, range: ReportRange): Block[] {
    const lines = markdown
        .replace(/^<!--[\s\S]*?-->\s*/, "")
        .replace(" אפשר להזיז.", "")
        .split("\n");
    const blocks: Block[] = [];
    let index = 0;
    let seenHeading = false;
    let metaUsed = false;

    while (index < lines.length) {
        const trimmed = lines[index].trim();
        if (!trimmed) {
            index += 1;
            continue;
        }
        if (trimmed.startsWith("|")) {
            const rows: string[][] = [];
            while (index < lines.length && lines[index].trim().startsWith("|")) {
                const cells = lines[index]
                    .trim()
                    .replace(/^\|/, "")
                    .replace(/\|$/, "")
                    .split("|")
                    .map((cell) => cell.trim());
                if (!cells.every((cell) => /^:?-+:?$/.test(cell))) {
                    rows.push(cells);
                }
                index += 1;
            }
            blocks.push({ kind: "table", rows });
            continue;
        }
        if (trimmed.startsWith(">")) {
            const text = trimmed.replace(/^>\s*/, "");
            const parts = text.split("גרף:").map((part) => part.trim()).filter(Boolean);
            blocks.push({
                kind: "chart",
                html: parts.map((part) => chartHtml(part, charts, range)).join(""),
            });
            index += 1;
            continue;
        }
        if (trimmed.startsWith("# ")) {
            seenHeading = true;
            blocks.push({ kind: "h1", html: `<h1>${inline(trimmed.slice(2))}</h1>` });
            index += 1;
            continue;
        }
        if (trimmed.startsWith("## ")) {
            const text = trimmed.slice(3);
            blocks.push({ kind: "h2", html: `<h2>${inline(text)}</h2>`, text });
            index += 1;
            continue;
        }
        if (trimmed.startsWith("- ")) {
            const items: string[] = [];
            while (index < lines.length && lines[index].trim().startsWith("- ")) {
                items.push(`<li>${inline(lines[index].trim().slice(2))}</li>`);
                index += 1;
            }
            blocks.push({ kind: "ul", html: `<ul>${items.join("")}</ul>` });
            continue;
        }
        if (/^\d+\.\s/.test(trimmed)) {
            const items: string[] = [];
            while (index < lines.length && /^\d+\.\s/.test(lines[index].trim())) {
                items.push(lines[index].trim().replace(/^\d+\.\s/, ""));
                index += 1;
            }
            blocks.push({ kind: "ol", items });
            continue;
        }
        const para: string[] = [trimmed];
        index += 1;
        while (
            index < lines.length &&
            lines[index].trim() &&
            !lines[index].trim().startsWith("#") &&
            !lines[index].trim().startsWith("- ") &&
            !lines[index].trim().startsWith("|") &&
            !lines[index].trim().startsWith(">") &&
            !/^\d+\.\s/.test(lines[index].trim())
        ) {
            para.push(lines[index].trim());
            index += 1;
        }
        const text = para.join(" ");
        const classes: string[] = [];
        if (text.startsWith("ההמלצות והתובנות")) {
            classes.push("disclaimer");
        } else if (seenHeading && !metaUsed) {
            classes.push("meta");
            metaUsed = true;
        }
        const classAttr = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
        blocks.push({ kind: "p", html: `<p${classAttr}>${inline(text)}</p>`, text });
    }
    return blocks;
}

function omittedCard(text: string): boolean {
    return (
        text.includes("הפרות תנאי") ||
        text.includes("חיסכון") ||
        text.includes("הכיסוי קטן") ||
        text.includes("עלות מכירות מזומן")
    );
}

function omittedChapter(text: string): boolean {
    return (
        text.includes("פעולות") ||
        text.includes("תובנות נוספות") ||
        text.includes("הכנה לחידוש") ||
        text.includes("מועדים שכבר") ||
        text.includes("מגמת תשלום") ||
        text.includes("דיווח באיחור") ||
        text.includes("ריכוז") ||
        text.includes("הפרות חוזרות")
    );
}

function renderCards(section: Block[]): string {
    const cards: string[] = [];
    let index = 0;
    while (index < section.length) {
        const block = section[index];
        if (block.kind !== "p") {
            index += 1;
            continue;
        }
        let list = "";
        const next = section[index + 1];
        if (next?.kind === "ul") {
            list = next.html;
            index += 1;
        }
        if (!omittedCard(block.text)) {
            const tone = ["a", "b", "c", "d"][cards.length % 4];
            cards.push(`<article class="card tone-${tone}">${block.html}${list}</article>`);
        }
        index += 1;
    }
    return `<div class="cards">${cards.join("")}</div>`;
}

function renderFlow(section: Block[], actions: boolean): string {
    const parts: string[] = [];
    let context = "";
    for (const block of section) {
        if (block.kind === "p") {
            context = block.text.startsWith("**") ? block.text : `${context}\n${block.text}`.trim();
        }
        if (block.kind === "chart" && parts.length > 0) {
            const prev = parts.pop() ?? "";
            parts.push(`<div class="chart-block">${prev}${block.html}</div>`);
            continue;
        }
        if (block.kind === "table") {
            const table = tableHtml(block.rows, context);
            const prev = parts[parts.length - 1] ?? "";
            if (prev.startsWith("<p")) {
                parts.pop();
                parts.push(`<div class="keep">${prev}${table}</div>`);
            } else {
                parts.push(table);
            }
            continue;
        }
        if (block.kind === "ol") {
            parts.push(
                actions
                    ? actionTable(block.items)
                    : `<ol>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`
            );
            continue;
        }
        if (block.kind === "h1" || block.kind === "h2") {
            parts.push(block.html);
            continue;
        }
        if (block.kind === "p" || block.kind === "ul" || block.kind === "chart") {
            parts.push(block.html);
        }
    }
    return parts.join("\n");
}

let chapterNo = 0;

function chapterHeading(text: string): string {
    chapterNo += 1;
    const title =
        text.includes("כרטיסים") || text.includes("מדדים") ? "תקציר מנהלים" : text;
    const num = String(chapterNo).padStart(2, "0");
    return `<h2><span class="badge">${num}</span>${inline(title)}</h2>`;
}

function renderSection(heading: { html: string; text: string }, section: Block[]): string {
    const summary = heading.text.includes("מדדים") || heading.text.includes("כרטיסים");
    const body = summary ? renderCards(section) : renderFlow(section, false);
    return `<section class="block">${chapterHeading(heading.text)}${body}</section>`;
}

type TermSensitivityRow = {
    days: number;
    invoiceCount: number;
    amount: number;
    customerCount: number;
    improvementPct: number;
};

type TermSensitivityTable = {
    currentDays: number;
    exampleCustomerName: string | null;
    exampleAmount: number;
    rows: TermSensitivityRow[];
};

type TermSensitivity = {
    paymentTerms: TermSensitivityTable & { clearingDays: number | null };
    createdAtMep: TermSensitivityTable;
    reporting: TermSensitivityTable & { asOf: string };
};

function reportMoney(amount: number): string {
    if (amount <= 0) {
        return "0";
    }
    if (amount >= 1_000_000) {
        return `${(amount / 1_000_000).toFixed(1)}M ₪`;
    }
    return `${Math.round(amount).toLocaleString("he-IL")} ₪`;
}

function reportPct(value: number): string {
    if (value <= 0) {
        return "0%";
    }
    if (value >= 99.95) {
        return "100%";
    }
    return `${value.toFixed(1)}%`;
}

function reportCount(value: number): string {
    return value.toLocaleString("he-IL");
}

function heLongDate(ymdValue: string): string {
    return new Intl.DateTimeFormat("he-IL", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(`${ymdValue}T00:00:00.000Z`));
}

function sensitivityTable(header: string, rows: TermSensitivityRow[]): string {
    const body = rows
        .map(
            (row) =>
                `| ${row.days} | ${reportCount(row.invoiceCount)} | ${reportMoney(row.amount)} | ${reportCount(row.customerCount)} | ${reportPct(row.improvementPct)} |`
        )
        .join("\n");
    return `| ${header} | חשבוניות שעדיין חורגות | סכום | לקוחות | שיפור |\n|---|---|---|---|---|\n${body}`;
}

function exampleLine(table: TermSensitivityTable): string {
    if (!table.exampleCustomerName) {
        return "";
    }
    return `\n\nדוגמה: הלקוח ${table.exampleCustomerName}, ${reportMoney(table.exampleAmount)}.`;
}

/** Standing chapter. Numbers come from this run. Omitted when the draft already has it. */
function termSensitivityMarkdown(data: TermSensitivity): string {
    const payment = data.paymentTerms;
    const paymentNow = payment.rows[0];
    const paymentAsk =
        payment.clearingDays != null
            ? ` ההמלצה היא לבקש מהמבטח ${payment.clearingDays} ימי אשראי, המספר הנמוך ביותר שבו לא נותרת חריגה מתנאי התשלום בתקופה, ובתוך התקרה של 180 יום.`
            : paymentNow && paymentNow.invoiceCount > 0
              ? " גם במקסימום של 180 יום נותרות חריגות. אין המלצה לימי אשראי מעל 180."
              : "";
    const paymentIntro = paymentNow
        ? `**תנאי תשלום.** במקסימום של ${payment.currentDays} יום נותרו ${reportCount(paymentNow.invoiceCount)} חשבוניות חורגות, בסך ${reportMoney(paymentNow.amount)}, אצל ${reportCount(paymentNow.customerCount)} לקוחות.${paymentAsk} השיפור הוא הירידה בסכום החריגה לעומת ${payment.currentDays} יום.`
        : "**תנאי תשלום.** אין מקסימום תנאי תשלום בנתוני התקופה.";
    const mep = data.createdAtMep;
    const mepNow = mep.rows[0];
    const mepIntro = mepNow
        ? `**הנפקה בחריגת MEP.** חשבוניות שהונפקו לאחר שהלקוח כבר חרג מימי ה־MEP. בימי MEP של ${mep.currentDays} נותרו ${reportCount(mepNow.invoiceCount)} חשבוניות, בסך ${reportMoney(mepNow.amount)}, אצל ${reportCount(mepNow.customerCount)} לקוחות. אין המלצה למספר ימים מסוים.`
        : "**הנפקה בחריגת MEP.** אין נתון של ימי MEP בחשבוניות התקופה.";
    const reporting = data.reporting;
    const reportingNow = reporting.rows[0];
    const reportingIntro = reportingNow
        ? `**דיווח.** חשבוניות פתוחות שטרם דווחו, נכון ל־${heLongDate(reporting.asOf)}. ב־${reporting.currentDays} ימי דיווח נותרו ${reportCount(reportingNow.invoiceCount)} חשבוניות, בסך ${reportMoney(reportingNow.amount)}, אצל ${reportCount(reportingNow.customerCount)} לקוחות. אין המלצה למספר ימים מסוים.`
        : "**דיווח.** אין נתון של ימי דיווח בפוליסה.";
    return [
        "## הפרות תנאים — הארכת ימי אשראי",
        "",
        "הטבלאות מתייחסות לחשבוניות חיוביות שהונפקו בתקופה. תנאי התשלום נבחנים מול מקסימום ימי האשראי, בהתאם לכלל חיתוך סוף החודש הקבוע בפוליסה. אין המלצה לימי אשראי מעל 180.",
        "",
        paymentIntro,
        "",
        payment.rows.length > 0 ? sensitivityTable("מקסימום", payment.rows) : "",
        exampleLine(payment),
        "",
        mepIntro,
        "",
        mep.rows.length > 0 ? sensitivityTable("ימי MEP", mep.rows) : "",
        exampleLine(mep),
        "",
        reportingIntro,
        "",
        reporting.rows.length > 0 ? sensitivityTable("ימי דיווח", reporting.rows) : "",
        exampleLine(reporting),
    ]
        .filter((line, index, all) => line !== "" || all[index - 1] !== "")
        .join("\n");
}

function renderMarkdown(
    markdown: string,
    charts: BundleCharts,
    range: ReportRange,
    sensitivityMarkdown: string
): string {
    chapterNo = 0;
    const blocks = parseMarkdown(markdown, charts, range);
    const html: string[] = [];
    let index = 0;
    let sensitivityPlaced = false;
    const placeSensitivity = () => {
        if (sensitivityPlaced || !sensitivityMarkdown) {
            return;
        }
        sensitivityPlaced = true;
        const extra = parseMarkdown(sensitivityMarkdown, charts, range);
        let extraIndex = 0;
        while (extraIndex < extra.length) {
            const extraBlock = extra[extraIndex];
            if (extraBlock.kind !== "h2") {
                extraIndex += 1;
                continue;
            }
            const section: Block[] = [];
            extraIndex += 1;
            while (
                extraIndex < extra.length &&
                extra[extraIndex].kind !== "h2" &&
                extra[extraIndex].kind !== "h1"
            ) {
                section.push(extra[extraIndex]);
                extraIndex += 1;
            }
            html.push(renderSection(extraBlock, section));
        }
    };
    while (index < blocks.length) {
        const block = blocks[index];
        if (block.kind === "h2") {
            const section: Block[] = [];
            index += 1;
            while (index < blocks.length && blocks[index].kind !== "h2" && blocks[index].kind !== "h1") {
                section.push(blocks[index]);
                index += 1;
            }
            if (omittedChapter(block.text)) {
                continue;
            }
            html.push(renderSection(block, section));
            continue;
        }
        if (block.kind === "p" && (block.html.includes("disclaimer") || block.html.includes('class="meta"'))) {
            index += 1;
            continue;
        }
        if (block.kind === "ol") {
            html.push(actionTable(block.items));
        } else if (block.kind === "table") {
            html.push(tableHtml(block.rows, ""));
        } else if (block.kind !== "h1") {
            html.push(block.html);
        }
        index += 1;
    }
    placeSensitivity();
    return html.join("\n");
}

function fileToDataUrl(filePath: string): string {
    const data = fs.readFileSync(filePath);
    return `data:image/png;base64,${data.toString("base64")}`;
}

type ReportHeader = {
    accountName: string;
    period: string;
    days: string;
    disclaimer: string;
    kpis: string;
};

function documentHtml(body: string, archaserSrc: string, header: ReportHeader): string {
    const archaserLogo = archaserSrc
        ? `<img class="archaser" src="${archaserSrc}" alt="ARchaser" />`
        : "";
    const footerName = header.accountName.replace(/"/g, "");
    return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @page {
    size: A4;
    margin: 12mm 12mm 14mm;
    @bottom-left {
      content: counter(page) " / " counter(pages);
      font-family: Arial, "Helvetica Neue", sans-serif;
      font-size: 8pt;
      color: #98A2B3;
    }
    @bottom-right {
      content: "${footerName} · מסמך סודי — הוכן עבור הלקוח בלבד";
      font-family: Arial, "Arial Hebrew", "Helvetica Neue", sans-serif;
      font-size: 8pt;
      color: #98A2B3;
    }
  }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    color: ${INK};
    background: #fff;
    font-family: Arial, "Arial Hebrew", "Helvetica Neue", sans-serif;
    font-size: 9pt;
    line-height: 1.45;
  }
  header.banner {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    background: ${ACCENT};
    color: #fff;
    border-radius: 14px;
    padding: 16px 18px 14px;
    margin-bottom: 10px;
  }
  header.banner .kicker { font-size: 8.5pt; opacity: 0.9; }
  header.banner h1 { font-size: 18pt; line-height: 1.2; margin: 2px 0 4px; color: #fff; }
  header.banner .sub { font-size: 8.5pt; opacity: 0.92; }
  header.banner .disclaimer { font-size: 7.5pt; line-height: 1.35; opacity: 0.88; margin: 8px 0 0; max-width: 92%; }
  header.banner img.archaser { height: 28px; width: auto; object-fit: contain; }
  .kpis { display: flex; gap: 8px; margin: 0 0 12px; }
  .kpi {
    flex: 1;
    background: #fff;
    border: 1px solid ${LINE};
    border-radius: 12px;
    padding: 8px 10px 7px;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
    break-inside: avoid;
  }
  .kpi .label { font-size: 7.5pt; color: ${MUTED}; }
  .kpi .value { font-size: 13pt; font-weight: 700; line-height: 1.2; margin-top: 2px; }
  .kpi .sub { font-size: 7pt; color: #98A2B3; margin-top: 2px; }
  .kpi.health { border-top: 3px solid ${ACCENT}; }
  .kpi.health .value { color: ${ACCENT}; }
  .kpi.risk { border-top: 3px solid ${RISK}; }
  .kpi.risk .value { color: ${RISK}; }
  .kpi.cost { border-top: 3px solid ${CHART_BLUE}; }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12pt;
    margin: 12px 0 6px;
    color: ${INK};
    break-after: avoid;
  }
  h2 .badge {
    background: ${ACCENT};
    color: #fff;
    border-radius: 999px;
    font-size: 8pt;
    font-weight: 700;
    padding: 2px 8px;
    flex: 0 0 auto;
  }
  p { margin: 0 0 4px; }
  .cards { display: flex; flex-direction: column; gap: 6px; }
  .card {
    background: #fff;
    border: 1px solid ${LINE};
    border-right: 4px solid ${ACCENT};
    border-radius: 8px;
    padding: 6px 10px;
    break-inside: avoid;
  }
  .card.tone-b { border-right-color: #F79009; }
  .card.tone-c { border-right-color: #12B76A; }
  .card.tone-d { border-right-color: ${CHART_BLUE}; }
  .card p { margin: 0; }
  .card p strong { display: block; margin-bottom: 2px; }
  .card ul { margin: 3px 0 0; }
  ul, ol { margin: 2px 0 6px; padding: 0 16px 0 0; }
  li { margin: 0 0 2px; }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin: 4px 0 8px;
    font-size: 8pt;
    break-inside: avoid;
    border: 1px solid ${LINE};
    border-radius: 10px;
    overflow: hidden;
  }
  th, td {
    border-bottom: 1px solid ${LINE};
    padding: 4px 6px;
    text-align: right;
    vertical-align: top;
    unicode-bidi: plaintext;
  }
  th { color: #fff; font-weight: 700; background: ${ACCENT}; }
  tr:last-child td { border-bottom: 0; }
  tr.pick td { background: #F4F0FF; font-weight: 700; }
  table.actions td.num { width: 18px; color: ${MUTED}; }
  table.actions td.priority { width: 18%; color: ${ACCENT}; font-weight: 700; }
  .chart-block, .keep, figure { break-inside: avoid; }
  figure { margin: 4px 0 8px; background: ${SURFACE}; border-radius: 12px; padding: 8px 10px 6px; }
  figcaption { font-size: 8pt; color: ${MUTED}; margin-bottom: 2px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px; font-size: 8pt; color: ${MUTED}; margin-top: 3px; }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    direction: ltr;
    padding: 1px 6px;
    border: 1px solid ${LINE};
    border-radius: 999px;
    background: #fff;
  }
  .legend i { display: inline-block; width: 14px; height: 3px; flex: 0 0 auto; }
  strong { font-weight: 700; }
</style>
</head>
<body>
<header class="banner">
  <div>
    <div class="kicker">סיכום תיק ביטוח אשראי</div>
    <h1>${header.accountName}</h1>
    <div class="sub">${header.period}${header.days ? ` · ${header.days}` : ""}</div>
    <p class="disclaimer">${header.disclaimer}</p>
  </div>
  ${archaserLogo}
</header>
${header.kpis}
${body}
</body>
</html>`;
}

function countPdfPages(filePath: string): number | null {
    const data = fs.readFileSync(filePath);
    const matches = data.toString("latin1").match(/\/Type\s*\/Page(?!s)/g);
    return matches ? matches.length : null;
}

async function main() {
    const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "";
    if (/sandbox|cursor-sandbox/i.test(browsersPath)) {
        delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    }

    const draftPath = readFlag(process.argv, "--draft") ?? DEFAULT_DRAFT;
    const bundlePath = readFlag(process.argv, "--bundle") ?? DEFAULT_BUNDLE;
    const pdfPath = readFlag(process.argv, "--out") ?? DEFAULT_PDF;
    const markdown = fs.readFileSync(draftPath, "utf8");
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")) as {
        account?: { id?: number; name?: string };
        range?: ReportRange;
        daysAvailable?: number;
        daysInRange?: number;
        portfolioHealth: {
            dailyA: DailyHealth[];
            monthlyA: MonthlyAr[];
            seriesA?: { averageHealthPct?: number };
        };
        utilization: { daily: DailyUtil[] };
        costs: { monthly: MonthlyCost[]; periodCost?: number };
        customerInsights?: { termSensitivity?: TermSensitivity };
    };
    const charts: BundleCharts = {
        dailyHealth: bundle.portfolioHealth.dailyA,
        monthlyAr: bundle.portfolioHealth.monthlyA,
        dailyUtil: bundle.utilization.daily,
        monthlyCost: bundle.costs.monthly,
    };
    const range = bundle.range ?? { from: "", to: "" };
    const archaserSrc = fs.existsSync(LOGO) ? fileToDataUrl(LOGO) : "";
    const last = bundle.portfolioHealth.dailyA.at(-1);
    const open = last ? last.compliantExposure + last.atRiskExposure : 0;
    const peak = bundle.portfolioHealth.dailyA.reduce(
        (max, row) => Math.max(max, row.healthIndex),
        0
    );
    const periodCost =
        bundle.costs.periodCost ??
        bundle.costs.monthly.reduce((total, month) => total + month.totalCost, 0);
    const disclaimerMatch = markdown.match(/ההמלצות והתובנות[\s\S]*?(?=\n## |\n# )/);
    const disclaimer = (disclaimerMatch?.[0] ?? "").replace(/\s+/g, " ").trim();
    const period =
        range.from && range.to ? `${heLongDate(range.from)} – ${heLongDate(range.to)}` : "";
    const days =
        bundle.daysAvailable != null && bundle.daysInRange != null
            ? `${bundle.daysAvailable} מתוך ${bundle.daysInRange} ימים זמינים`
            : "";
    const kpis = `<div class="kpis">
<article class="kpi health"><div class="label">רמת הגנת אשראי</div><div class="value">${last ? `${last.healthIndex.toFixed(1)}%` : "—"}</div><div class="sub">${bundle.portfolioHealth.seriesA?.averageHealthPct != null ? `ממוצע ${bundle.portfolioHealth.seriesA.averageHealthPct.toFixed(1)}%` : ""}${peak > 0 ? ` · שיא ${peak.toFixed(1)}%` : ""}</div></article>
<article class="kpi risk"><div class="label">חוב בסיכון</div><div class="value">${open > 0 && last ? `${((last.atRiskExposure / open) * 100).toFixed(1)}%` : "—"}</div><div class="sub">מהיתרה הפתוחה</div></article>
<article class="kpi risk"><div class="label">חשיפה בסיכון</div><div class="value">${last ? reportMoney(last.atRiskExposure) : "—"}</div><div class="sub">${last ? `מתוך ${reportMoney(open)}` : ""}</div></article>
<article class="kpi cost"><div class="label">עלות פוליסה</div><div class="value">${reportMoney(periodCost)}</div><div class="sub">דמי ביטוח + דמי רישום + כיסוי עילי</div></article>
</div>`;
    const sensitivity = bundle.customerInsights?.termSensitivity
        ? termSensitivityMarkdown(bundle.customerInsights.termSensitivity)
        : "";
    const html = documentHtml(
        renderMarkdown(markdown, charts, range, sensitivity),
        archaserSrc,
        {
            accountName: bundle.account?.name ?? "",
            period,
            days,
            disclaimer,
            kpis,
        }
    );
    const htmlPath = pdfPath.replace(/\.pdf$/i, ".html");
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.writeFileSync(htmlPath, html);

    const requireFromFrontend = createRequire(
        path.resolve(__dirname, "../../../frontend/package.json")
    );
    const { chromium } = requireFromFrontend("playwright") as {
        chromium: {
            launch: (opts?: { headless?: boolean; executablePath?: string }) => Promise<{
                newPage: () => Promise<{
                    goto: (url: string, opts?: { waitUntil?: string }) => Promise<unknown>;
                    pdf: (opts: Record<string, unknown>) => Promise<void>;
                    close: () => Promise<void>;
                }>;
                close: () => Promise<void>;
            }>;
        };
    };
    const brave = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
    let browser: Awaited<ReturnType<typeof chromium.launch>>;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (!fs.existsSync(brave)) {
            throw error;
        }
        browser = await chromium.launch({
            headless: true,
            executablePath: brave,
        });
    }
    try {
        const page = await browser.newPage();
        await page.goto(pathToFileUrl(htmlPath), { waitUntil: "load" });
        await page.pdf({
            path: pdfPath,
            format: "A4",
            printBackground: true,
            margin: { top: "11mm", bottom: "13mm", left: "12mm", right: "12mm" },
        });
        await page.close();
    } finally {
        await browser.close();
    }
    const pages = countPdfPages(pdfPath);
    console.log(
        `[portfolio-summary-poc] wrote ${pdfPath}${pages != null ? `, ${pages} pages` : ""}`
    );
}

function pathToFileUrl(filePath: string): string {
    const resolved = path.resolve(filePath);
    return `file://${resolved}`;
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[portfolio-summary-poc] ${message}`);
    if (/browserType\.launch|Executable doesn't exist|browsers/i.test(message)) {
        console.error(
            "[portfolio-summary-poc] Playwright Chromium is missing. Install it on this machine; this script does not download a browser."
        );
    }
    process.exit(1);
});
