from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, HRFlowable, KeepTogether, LongTable, PageBreak,
    PageTemplate, Paragraph, Preformatted, Spacer, Table, TableStyle
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "MANUAL_COMPLETO.md"
OUTPUT = ROOT / "output" / "pdf" / "MANUAL_COMPLETO_FM-DX_WINDOWS_PORTABLE.pdf"

PAGE_W, PAGE_H = A4
NAVY = colors.HexColor("#0B1F33")
BLUE = colors.HexColor("#087EA4")
CYAN = colors.HexColor("#18B6C9")
INK = colors.HexColor("#1D2733")
MUTED = colors.HexColor("#5F6B76")
PALE = colors.HexColor("#EAF6F8")
LINE = colors.HexColor("#C8D7DE")
CODE_BG = colors.HexColor("#F3F6F8")


def register_fonts():
    font_dir = Path(r"C:\Windows\Fonts")
    regular = font_dir / "segoeui.ttf"
    bold = font_dir / "segoeuib.ttf"
    mono = font_dir / "consola.ttf"
    mono_bold = font_dir / "consolab.ttf"
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("ManualSans", str(regular)))
        pdfmetrics.registerFont(TTFont("ManualSans-Bold", str(bold)))
    if mono.exists():
        pdfmetrics.registerFont(TTFont("ManualMono", str(mono)))
    if mono_bold.exists():
        pdfmetrics.registerFont(TTFont("ManualMono-Bold", str(mono_bold)))


register_fonts()
SANS = "ManualSans" if "ManualSans" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
SANS_BOLD = "ManualSans-Bold" if "ManualSans-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
MONO = "ManualMono" if "ManualMono" in pdfmetrics.getRegisteredFontNames() else "Courier"


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, **kwargs)
        frame = Frame(
            20 * mm, 18 * mm, PAGE_W - 40 * mm, PAGE_H - 35 * mm,
            leftPadding=0, rightPadding=0, topPadding=8 * mm, bottomPadding=7 * mm,
            id="normal"
        )
        self.addPageTemplates(PageTemplate(id="manual", frames=[frame], onPage=self.draw_page))
        self._bookmark_id = 0

    def draw_page(self, canvas, doc):
        canvas.saveState()
        if doc.page > 1:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.5)
            canvas.line(20 * mm, PAGE_H - 13 * mm, PAGE_W - 20 * mm, PAGE_H - 13 * mm)
            canvas.setFont(SANS, 8)
            canvas.setFillColor(MUTED)
            canvas.drawString(20 * mm, PAGE_H - 10 * mm, "FM-DX Windows Portable - Manual completo")
            canvas.drawRightString(PAGE_W - 20 * mm, 10 * mm, f"Pagina {doc.page}")
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and hasattr(flowable, "toc_level"):
            level = flowable.toc_level
            text = flowable.getPlainText()
            key = flowable.bookmark_key
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=level, closed=False)
            self.notify("TOCEntry", (level, text, self.page, key))


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="ManualBody", fontName=SANS, fontSize=9.3, leading=13.2,
    textColor=INK, spaceAfter=5.5, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="ManualH1", fontName=SANS_BOLD, fontSize=18, leading=22,
    textColor=NAVY, spaceBefore=8, spaceAfter=10, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="ManualH2", fontName=SANS_BOLD, fontSize=14, leading=18,
    textColor=BLUE, spaceBefore=5, spaceAfter=8, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="ManualH3", fontName=SANS_BOLD, fontSize=11, leading=14,
    textColor=NAVY, spaceBefore=7, spaceAfter=4, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="ManualBullet", parent=styles["ManualBody"], leftIndent=12, firstLineIndent=-7,
    bulletIndent=2, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="ManualNumber", parent=styles["ManualBody"], leftIndent=15, firstLineIndent=-10,
    bulletIndent=1, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="ManualQuote", parent=styles["ManualBody"], leftIndent=10, rightIndent=8,
    borderColor=CYAN, borderWidth=1, borderPadding=7, backColor=PALE,
    textColor=NAVY, spaceBefore=5, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="ManualCode", fontName=MONO, fontSize=7.4, leading=10,
    leftIndent=6, rightIndent=6, borderColor=LINE, borderWidth=0.5,
    borderPadding=7, backColor=CODE_BG, textColor=colors.HexColor("#263238"),
    spaceBefore=4, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="TOCHeading", fontName=SANS_BOLD, fontSize=20, leading=24,
    textColor=NAVY, spaceAfter=14,
))
styles.add(ParagraphStyle(
    name="CoverTitle", fontName=SANS_BOLD, fontSize=28, leading=34,
    textColor=colors.white, alignment=TA_CENTER, spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="CoverSub", fontName=SANS, fontSize=13, leading=19,
    textColor=colors.HexColor("#D5F4F8"), alignment=TA_CENTER,
))


def inline_markup(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"\[([^]]+)\]\((https?://[^)]+)\)", r'<link href="\2" color="#087EA4">\1</link>', text)
    text = re.sub(r"(?<!`)`([^`]+)`", lambda m: f'<font name="{MONO}" color="#0B6074">{m.group(1)}</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*", r"<i>\1</i>", text)
    url_re = r"(?<![\"=>])(https?://[^\s<]+)"
    text = re.sub(url_re, r'<link href="\1" color="#087EA4">\1</link>', text)
    return text


_heading_serial = 0


def make_heading(text: str, level: int) -> Paragraph:
    global _heading_serial
    style = styles["ManualH2"] if level == 0 else styles["ManualH3"]
    p = Paragraph(inline_markup(text), style)
    p.toc_level = level
    p.bookmark_key = f"section-{_heading_serial}"
    _heading_serial += 1
    return p


def parse_table(rows: list[str]):
    cells = []
    for row in rows:
        parts = [x.strip() for x in row.strip().strip("|").split("|")]
        cells.append(parts)
    if len(cells) >= 2 and all(re.fullmatch(r":?-{3,}:?", x.replace(" ", "")) for x in cells[1]):
        cells.pop(1)
    width = PAGE_W - 40 * mm
    columns = max(len(r) for r in cells)
    if columns == 2:
        widths = [width * 0.30, width * 0.70]
    elif columns == 3:
        widths = [width * 0.22, width * 0.38, width * 0.40]
    else:
        widths = [width / columns] * columns
    data = []
    for r, row in enumerate(cells):
        row = row + [""] * (columns - len(row))
        data.append([Paragraph(inline_markup(x), ParagraphStyle(
            f"cell-{r}-{c}", parent=styles["ManualBody"], fontSize=7.6, leading=10,
            textColor=colors.white if r == 0 else INK,
            fontName=SANS_BOLD if r == 0 else SANS,
            spaceAfter=0,
        )) for c, x in enumerate(row)])
    table = LongTable(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7FAFB")]),
    ]))
    return table


def markdown_story(text: str):
    lines = text.splitlines()
    story = []
    i = 0
    para = []
    started = False

    def flush_para():
        nonlocal para
        if para:
            joined = " ".join(x.strip() for x in para)
            story.append(Paragraph(inline_markup(joined), styles["ManualBody"]))
            para = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("# "):
            i += 1
            continue
        if stripped.startswith("## "):
            if started:
                flush_para()
                story.append(PageBreak())
            else:
                para = []
                started = True
            story.append(make_heading(stripped[3:], 0))
            i += 1
            continue
        if not started:
            i += 1
            continue
        if stripped.startswith("### "):
            flush_para()
            story.append(make_heading(stripped[4:], 1))
            i += 1
            continue
        if stripped.startswith("```"):
            flush_para()
            language = stripped[3:].strip()
            i += 1
            code = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1
            label = Paragraph(f"<b>{html.escape(language or 'texto')}</b>", ParagraphStyle(
                "CodeLabel", parent=styles["ManualBody"], fontSize=7, textColor=MUTED, spaceAfter=1
            ))
            story.append(KeepTogether([label, Preformatted("\n".join(code), styles["ManualCode"])]))
            continue
        if stripped.startswith("|"):
            flush_para()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            story.append(parse_table(rows))
            story.append(Spacer(1, 7))
            continue
        if re.match(r"^[-*] ", stripped):
            flush_para()
            story.append(Paragraph(inline_markup(stripped[2:]), styles["ManualBullet"], bulletText="-"))
            i += 1
            continue
        numbered = re.match(r"^(\d+)\.\s+(.*)", stripped)
        if numbered:
            flush_para()
            story.append(Paragraph(inline_markup(numbered.group(2)), styles["ManualNumber"], bulletText=numbered.group(1) + "."))
            i += 1
            continue
        if stripped.startswith("> "):
            flush_para()
            story.append(Paragraph(inline_markup(stripped[2:]), styles["ManualQuote"]))
            i += 1
            continue
        if stripped == "---":
            flush_para()
            story.append(Spacer(1, 4))
            story.append(HRFlowable(width="100%", thickness=0.6, color=LINE))
            story.append(Spacer(1, 5))
            i += 1
            continue
        if not stripped:
            flush_para()
            i += 1
            continue
        para.append(line)
        i += 1
    flush_para()
    return story


def cover_story():
    title = Paragraph("FM-DX Windows Portable", styles["CoverTitle"])
    sub = Paragraph("Manual completo de uso, hardware, HD Radio, red y publicacion en GitHub", styles["CoverSub"])
    version = Paragraph("Version 0.3.0 | Windows 10/11 x64 | Julio de 2026", styles["CoverSub"])
    panel = Table([[title], [sub], [Spacer(1, 12)], [version]], colWidths=[PAGE_W - 40 * mm], rowHeights=[45 * mm, 30 * mm, 8 * mm, 15 * mm])
    panel.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 1.2, CYAN),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
    ]))
    return [Spacer(1, 36 * mm), panel, Spacer(1, 18 * mm), Paragraph(
        "Airspy HF+ Discovery | RTL-SDR | TEF668x/XDR<br/>FM estereo adaptativo | RDS | NRSC-5 HD Radio | Artwork LOT",
        ParagraphStyle("CoverFeatures", parent=styles["ManualBody"], alignment=TA_CENTER, fontSize=11, leading=17, textColor=NAVY)
    ), PageBreak()]


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    text = SOURCE.read_text(encoding="utf-8")
    doc = ManualDocTemplate(
        str(OUTPUT), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title="Manual completo - FM-DX Windows Portable",
        author="FM-DX Windows Portable",
        subject="Uso, configuracion, diagnostico y publicacion en GitHub",
    )
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOC0", fontName=SANS_BOLD, fontSize=10, leading=14, leftIndent=0, firstLineIndent=0, textColor=NAVY, spaceBefore=4),
        ParagraphStyle("TOC1", fontName=SANS, fontSize=8.5, leading=12, leftIndent=12, firstLineIndent=0, textColor=MUTED),
    ]
    story = cover_story()
    story.extend([Paragraph("Contenido", styles["TOCHeading"]), toc, PageBreak()])
    story.extend(markdown_story(text))
    doc.multiBuild(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()



