"""
GoldPlus catalogue price + image audit workbook.

  1. Export the data (read-only) on the host:
       docker exec -i goldplus-commerce-postgres-1 psql -U goldplus -d goldplus \
         < scripts/reports/catalogue-audit-export.sql
       docker cp goldplus-commerce-postgres-1:/tmp/catalogue.csv ./catalogue.csv
  2. Build:
       pip install openpyxl
       DATA_DIR=. OUT=audit.xlsx python3 scripts/reports/build-catalogue-audit-xlsx.py

Sheets: Read me · Price audit (bands A-D) · Photo status · Image spec ·
Confidential - cost (delete before sharing outside the business).
"""
import csv, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

import os
S = os.environ.get('DATA_DIR', '.')          # folder containing catalogue.csv
OUT = os.environ.get('OUT', 'GoldPlus-Catalogue-Price-and-Image-Audit.xlsx')
rows = list(csv.DictReader(open(f'{S}/catalogue.csv')))

def n(r, k):
    v = (r.get(k) or '').strip()
    return int(float(v)) if v else None

def is_live(r):
    return r['active'] == 't' and r['approval_status'] == 'approved'

# Every finding stated in the workbook is computed here from the export, never typed in:
# the generator is re-run as the catalogue changes, and a hand-written count goes stale silently.
EXPORTED = datetime.datetime.fromtimestamp(os.path.getmtime(f'{S}/catalogue.csv'))
live_rows = [x for x in rows if is_live(x)]
not_live = [x for x in rows if not is_live(x)]
demo_rows = [x for x in not_live if x['approval_status'] == 'rejected']
priced = [x for x in rows if n(x, 'retail_price')]
band_violations = [x for x in priced if any(
    lo is not None and hi is not None and lo > hi
    for lo, hi in zip([n(x, k) for k in ('floor_price', 'tier_b_price', 'tier_c_price')],
                      [n(x, k) for k in ('tier_b_price', 'tier_c_price', 'retail_price')]))]
costed = [x for x in priced if n(x, 'cost_price')]
half_cost = [x for x in costed if n(x, 'cost_price') * 2 == n(x, 'retail_price')]
cost_is_formula = bool(costed) and len(half_cost) == len(costed)
dealer_set = [x for x in rows if n(x, 'dealer_price')]

def plural(k, one, many=None):
    return f'{k} {one if k == 1 else (many or one + "s")}'

INK = '0A0A0A'; LIME = '93D500'; GREY = 'F2F2F2'; AMBER = 'FFF4CE'; RED = 'FDE7E9'; GREEN = 'E8F5E0'
hdr_fill = PatternFill('solid', fgColor=INK)
hdr_font = Font(color='FFFFFF', bold=True, size=10)
title_font = Font(bold=True, size=16, color=INK)
sub_font = Font(size=10, color='6B6B6B')
thin = Side(style='thin', color='D9D9D9')
box = Border(left=thin, right=thin, top=thin, bottom=thin)
UGX = '#,##0'
PCT = '0.0%'

wb = Workbook()

def style_header(ws, row, ncols, widths=None, freeze=None):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = hdr_fill; cell.font = hdr_font
        cell.alignment = Alignment(vertical='center', wrap_text=True)
        cell.border = box
    ws.row_dimensions[row].height = 30
    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
    if freeze:
        ws.freeze_panes = freeze

# ─────────────────────────────── 1. Read me ───────────────────────────────
ws = wb.active; ws.title = 'Read me'
ws.column_dimensions['A'].width = 4
ws.column_dimensions['B'].width = 34
ws.column_dimensions['C'].width = 96
r = 2
ws.cell(r, 2, 'GoldPlus — catalogue price and image audit').font = title_font
r += 1
ws.cell(r, 2, f'Prepared {datetime.date.today():%d %B %Y} from an export taken {EXPORTED:%d %B %Y %H:%M} · read directly from the live production database (read-only) · shopgoldplus.com').font = sub_font
r += 2

def block(title, lines):
    global r
    c = ws.cell(r, 2, title); c.font = Font(bold=True, size=11, color=INK)
    c.fill = PatternFill('solid', fgColor=GREY); c.border = box
    ws.cell(r, 3).fill = PatternFill('solid', fgColor=GREY); ws.cell(r, 3).border = box
    r += 1
    for label, text in lines:
        a = ws.cell(r, 2, label); a.font = Font(bold=True, size=10); a.alignment = Alignment(vertical='top')
        b = ws.cell(r, 3, text); b.font = Font(size=10); b.alignment = Alignment(wrap_text=True, vertical='top')
        ws.row_dimensions[r].height = max(15, 13 * (1 + len(text) // 95))
        r += 1
    r += 1

block('What is in this workbook', [
    ('Price audit', 'Every product in the catalogue, in category then SKU order, with its price in all four selling bands.'),
    ('Photo status', 'What photography each product actually has today, and what is still a placeholder.'),
    ('Image spec', 'The exact pixel sizes the design team must deliver for every image on the website.'),
    ('Confidential — cost', 'Cost and margin. SEPARATE SHEET ON PURPOSE: delete it before sending this file outside the business.'),
])

block('The four price bands', [
    ('Price D — Retail', 'What the website charges. This is the published price a customer pays.'),
    ('Price C', 'Intermediate band held in the price workbook. No website surface reads it today.'),
    ('Price B', 'Intermediate band held in the price workbook. No website surface reads it today.'),
    ('Price A — Floor', 'The lowest price any discount may ever reach, set per product. A campaign that would go below it is capped at it.'),
    ('Rule enforced in code', f'A ≤ B ≤ C ≤ D. Checked across {plural(len(priced), "priced product")}: '
        + ('no violations.' if not band_violations else
           f'{plural(len(band_violations), "violation")} — ' + ', '.join(x['sku'] for x in band_violations) + '.')),
])

block('What to check when auditing', [
    ('1. Retail price', 'Is Price D what you intend to charge today? This is the number customers see.'),
    ('2. Floor price', 'Is Price A the lowest you would ever accept? Discount headroom shows how far a campaign can cut.'),
    ('3. Bands B and C', 'They are recorded but unused. Confirm they are still the numbers you want kept.'),
    ('4. Flags column', 'Anything needing attention is named in plain words. An empty flag means nothing was found.'),
    ('5. Photo status', 'Products marked "placeholder" or "sample" have no real photography on the site yet.'),
])

findings = []
if cost_is_formula:
    findings.append(('Cost looks formula-derived', f'Every recorded cost is exactly half the retail price — all {len(costed)}, to the shilling. That is a formula, not measured supplier cost. Margin at retail therefore reads exactly 50% everywhere and should not be trusted as real.'))
elif half_cost:
    findings.append(('Some costs look formula-derived', f'{len(half_cost)} of {len(costed)} recorded costs are exactly half the retail price. Check those before trusting their margin.'))
if not_live:
    others = len(not_live) - len(demo_rows)
    findings.append((f'{plural(len(not_live), "product is", "products are")} not on sale',
        f'Shaded grey. {plural(len(demo_rows), "is a demonstration record", "are demonstration records")} never published'
        + (f'; {plural(others, "other is", "others are")} inactive or unapproved and kept for history' if others else '')
        + f'. Listed so the count reconciles to {len(rows)}.'))
block('Findings to read before auditing', findings or [('None', 'Nothing unusual was found in this export.')])

block('Provenance', [
    ('Source', f'Live production database, read-only query, exported {EXPORTED:%d %B %Y}.'),
    ('Scope', f'{plural(len(rows), "product record")}. {len(live_rows)} on sale (active and approved); the other {len(not_live)} shaded grey on every sheet.'),
    ('Currency', 'Ugandan shillings (UGX), whole shillings, no decimals.'),
    ('Dealer price', 'The database has a dealer price column. ' + (
        'It is empty for every product, so no dealer band exists to audit.' if not dealer_set
        else f'{plural(len(dealer_set), "product has", "products have")} one; it is not audited here.')),
])

# ─────────────────────────────── 2. Price audit ───────────────────────────────
ws = wb.create_sheet('Price audit')
headers = ['Category', 'SKU', 'Model', 'Product name', 'Status', 'In stock',
           'Price A — Floor (UGX)', 'Price B (UGX)', 'Price C (UGX)', 'Price D — Retail (UGX)',
           'Discount headroom (UGX)', 'Max discount %', 'Flags']
widths = [17, 18, 18, 52, 12, 10, 19, 15, 15, 20, 19, 14, 46]
ws.cell(1, 1, 'Price audit — every product, every band, in category then SKU order').font = title_font
ws.cell(2, 1, 'Price D is what customers pay. Price A is the lowest any discount may reach. Bands B and C are recorded but no website surface reads them.').font = sub_font
for i, h in enumerate(headers, start=1):
    ws.cell(4, i, h)
style_header(ws, 4, len(headers), widths, freeze='A5')

row = 5
for rec in rows:
    A, B, C, D = n(rec, 'floor_price'), n(rec, 'tier_b_price'), n(rec, 'tier_c_price'), n(rec, 'retail_price')
    live = rec['active'] == 't' and rec['approval_status'] == 'approved'
    flags = []
    if not live:
        flags.append('Not on sale — demonstration record, never published' if rec['approval_status'] == 'rejected'
                     else 'Not on sale — inactive or awaiting approval; kept for history')
    if rec in band_violations:
        flags.append('Bands out of order: A ≤ B ≤ C ≤ D does not hold')
    if A and D and A == D:
        flags.append('No discount headroom: floor equals retail')
    if B is None and live:
        flags.append('Bands B and C not set')
    if D and A and D > 0 and (D - A) / D > 0.5:
        flags.append('Headroom over 50% of retail — confirm the floor is intended')
    status = 'On sale' if live else ('Demo record' if rec['approval_status'] == 'rejected' else 'Not on sale')
    vals = [rec['category_name'] or '—', rec['sku'], rec['model_number'], rec['name'], status,
            n(rec, 'stock_quantity'), A, B, C, D,
            (D - A) if (A and D) else None,
            ((D - A) / D) if (A and D) else None,
            '; '.join(flags)]
    for i, v in enumerate(vals, start=1):
        c = ws.cell(row, i, v)
        c.border = box
        c.font = Font(size=10)
        if i in (7, 8, 9, 10, 11):
            c.number_format = UGX
        if i == 12:
            c.number_format = PCT
        if i == 6:
            c.number_format = '#,##0'
        if i == 4:
            c.alignment = Alignment(wrap_text=True, vertical='top')
        if i == 13:
            c.alignment = Alignment(wrap_text=True, vertical='top')
    if not live:
        for i in range(1, len(headers) + 1):
            ws.cell(row, i).fill = PatternFill('solid', fgColor=GREY)
    elif flags:
        for i in range(1, len(headers) + 1):
            ws.cell(row, i).fill = PatternFill('solid', fgColor=AMBER)
    row += 1

last = row - 1
ws.auto_filter.ref = f'A4:M{last}'
# Totals strip
ws.cell(row + 1, 4, 'Products listed').font = Font(bold=True, size=10)
ws.cell(row + 1, 5, len(rows)).font = Font(bold=True, size=10)
ws.cell(row + 2, 4, 'Of which on sale').font = Font(bold=True, size=10)
ws.cell(row + 2, 5, sum(1 for x in rows if x['active'] == 't' and x['approval_status'] == 'approved')).font = Font(bold=True, size=10)
ws.cell(row + 3, 4, 'Retail value of one of each (on sale only)').font = Font(bold=True, size=10)
tot = sum(n(x, 'retail_price') or 0 for x in rows if x['active'] == 't' and x['approval_status'] == 'approved')
c = ws.cell(row + 3, 5, tot); c.font = Font(bold=True, size=10); c.number_format = UGX

# ─────────────────────────────── 3. Photo status ───────────────────────────────
ws = wb.create_sheet('Photo status')
headers = ['Category', 'SKU', 'Product name', 'Status', 'Gallery slots filled', 'Real photographs', 'Placeholder / sample frames', 'What this product needs']
widths = [17, 18, 52, 12, 19, 17, 25, 52]
ws.cell(1, 1, 'Photo status — what photography exists today').font = title_font
ws.cell(2, 1, 'Every product shows four gallery frames. Where a real photograph does not exist, the frame is a clearly labelled sample and is excluded from Google, share previews and structured data.').font = sub_font
for i, h in enumerate(headers, start=1):
    ws.cell(4, i, h)
style_header(ws, 4, len(headers), widths, freeze='A5')

row = 5
for rec in rows:
    slots = n(rec, 'slots') or 0
    samples = n(rec, 'sample_slots') or 0
    real = slots - samples
    live = rec['active'] == 't' and rec['approval_status'] == 'approved'
    if not live:
        need = 'Not on sale — no photography needed'
    elif real == 0:
        need = 'All four frames: cover, alternate, detail, contents (2000 × 2000 px)'
    elif real >= 4:
        need = 'Complete'
    else:
        need = f'{4 - real} more real photograph(s): ' + ', '.join(['alternate angle', 'fit detail', 'box contents or scale'][: 4 - real])
    vals = [rec['category_name'] or '—', rec['sku'], rec['name'],
            'On sale' if live else ('Demo record' if rec['approval_status'] == 'rejected' else 'Not on sale'), slots, real, samples, need]
    for i, v in enumerate(vals, start=1):
        c = ws.cell(row, i, v); c.border = box; c.font = Font(size=10)
        if i in (3, 8):
            c.alignment = Alignment(wrap_text=True, vertical='top')
    fill = GREY if not live else (GREEN if real >= 4 else (RED if real == 0 else AMBER))
    for i in range(1, len(headers) + 1):
        ws.cell(row, i).fill = PatternFill('solid', fgColor=fill)
    row += 1
ws.auto_filter.ref = f'A4:H{row - 1}'

# ─────────────────────────────── 4. Image spec ───────────────────────────────
ws = wb.create_sheet('Image spec')
headers = ['Priority', 'Where it appears', 'Deliver at (pixels)', 'Aspect', 'Format', 'Background', 'Notes for the photographer / designer']
widths = [9, 30, 22, 12, 12, 18, 66]
ws.cell(1, 1, 'Image specification — what the design team delivers').font = title_font
ws.cell(2, 1, 'Send ONE master per image at the size below. The website generates every smaller size and modern format automatically. Never send @2x or @3x versions.').font = sub_font
for i, h in enumerate(headers, start=1):
    ws.cell(4, i, h)
style_header(ws, 4, len(headers), widths, freeze='A5')

spec = [
    ('1', 'Homepage hero — full-photo slide', '2400 × 1600', '3:2', 'JPEG q80–85', 'Lifestyle', 'Cropped to fill; anchored right on desktop. Keep the left third and bottom half visually simple — the headline and buttons sit there. The three photos on the site today are only 760 px wide and are being upscaled: replacing them is the highest-value image job.'),
    ('1', 'Homepage hero — product slide', '1600 × 1600', '1:1', 'JPEG q80–85', 'Pure white', 'Composited with multiply blending, so the background must be pure white with no baked-in drop shadow.'),
    ('2', 'Product gallery — frame 1, cover', '2000 × 2000', '1:1', 'JPEG q80–85', 'White / very light', 'The product alone, correct model and colour, filling 70–85% of the frame, nothing clipped. No text, badges, price or spec panels on the image.'),
    ('2', 'Product gallery — frame 2, alternate', '2000 × 2000', '1:1', 'JPEG q80–85', 'White / very light', 'What the cover cannot show: back, side, open case, connector orientation.'),
    ('2', 'Product gallery — frame 3, detail', '2000 × 2000', '1:1', 'JPEG q80–85', 'White / very light', 'The part that answers "will this fit me": port, plug type, printed code, a control.'),
    ('2', 'Product gallery — frame 4, contents', '2000 × 2000', '1:1', 'JPEG q80–85', 'White / very light', 'The actual box contents, or an honest scale reference. Never props implying accessories that are not included.'),
    ('3', 'Homepage category tile', '1200 × 1200', '1:1', 'JPEG q80–85', 'Pure white', 'Multiply blending again — pure white only. Renders 120–190 px.'),
    ('3', 'Header mega-menu featured card', '1200 × 1200', '1:1', 'JPEG q80–85', 'Pure white', 'Renders inside a 132 px arch. The file in use today is 600 × 600.'),
    ('4', 'Header mega-menu category icon', '204 × 204', '1:1', 'PNG or WebP', 'Transparent', 'Renders 34 × 34. Files today are 102 × 102.'),
    ('4', 'Blog cover image', '1920 × 1080', '16:9', 'JPEG q80–85', 'Any', 'Cropped to fill the article width.'),
    ('4', 'Site wordmark', '640 × 184', '~3.5:1', 'PNG transparent or SVG', 'Transparent', 'Renders 30 px tall on desktop, 23–26 px on phones. Master today is 480 × 138.'),
    ('4', 'Payment and trust logos', 'vector', '—', 'SVG preferred', 'Transparent', 'Rendered 20–36 px tall in the footer.'),
    ('5', 'Default share image', '1200 × 630', '1.91:1', 'PNG or JPEG', 'Any', 'Exact size. Used on WhatsApp and Facebook when a page has no real product photograph.'),
    ('5', 'App icon', '512 × 512', '1:1', 'PNG', 'Opaque', 'We derive the 192 px and 180 px versions from this.'),
    ('5', 'App icon — maskable', '512 × 512', '1:1', 'PNG', 'Opaque', 'Keep all content inside the central 80%; the edges get cropped to a circle on Android.'),
    ('5', 'Favicon', 'vector + 32 × 32', '1:1', 'SVG + ICO', 'Transparent', '—'),
]
row = 5
for s in spec:
    for i, v in enumerate(s, start=1):
        c = ws.cell(row, i, v); c.border = box; c.font = Font(size=10)
        c.alignment = Alignment(wrap_text=True, vertical='top')
    ws.row_dimensions[row].height = max(30, 13 * (1 + len(s[6]) // 66))
    row += 1

ws.cell(row + 1, 2, 'File-size limits the website enforces automatically').font = Font(bold=True, size=10)
row += 2
for d, w, b in [('Hero images', '1600 px', '60 KB per generated file'), ('Navigation images', '400 px', '20 KB'),
                ('Legacy product files', '2048 px', '260 KB'), ('Icons and share image', '1280 px', '80 KB')]:
    ws.cell(row, 2, d).font = Font(size=10)
    ws.cell(row, 3, w).font = Font(size=10)
    ws.cell(row, 4, b).font = Font(size=10)
    row += 1

# ─────────────────────────────── 5. Confidential ───────────────────────────────
ws = wb.create_sheet('Confidential — cost')
ws.cell(1, 1, 'CONFIDENTIAL — cost and margin').font = Font(bold=True, size=16, color='9C0006')
ws.cell(2, 1, 'Delete this sheet before sending the workbook outside the business. Cost and margin must never reach a customer, a dealer or a supplier.').font = Font(size=10, bold=True, color='9C0006')
ws.cell(3, 1, f'IMPORTANT: every cost below is exactly half the retail price, for all {len(costed)} costed products, to the shilling. That is a placeholder formula, not measured supplier cost. Margin at retail therefore reads exactly 50% everywhere and must not be used for decisions until real costs are entered.'
         if cost_is_formula else 'Costs are as recorded in the database. Margin is only as good as the cost entered.').font = Font(size=10, color='9C0006')
ws.row_dimensions[3].height = 28
ws.cell(3, 1).alignment = Alignment(wrap_text=True, vertical='top')
headers = ['Category', 'SKU', 'Product name', 'Recorded cost (UGX)', 'Price A — Floor (UGX)', 'Price D — Retail (UGX)', 'Margin at retail', 'Margin at floor']
widths = [17, 18, 52, 20, 21, 22, 16, 16]
for i, h in enumerate(headers, start=1):
    ws.cell(5, i, h)
style_header(ws, 5, len(headers), widths, freeze='A6')
row = 6
for rec in rows:
    cost, A, D = n(rec, 'cost_price'), n(rec, 'floor_price'), n(rec, 'retail_price')
    vals = [rec['category_name'] or '—', rec['sku'], rec['name'], cost, A, D,
            ((D - cost) / D) if (cost and D) else None,
            ((A - cost) / A) if (cost and A) else None]
    for i, v in enumerate(vals, start=1):
        c = ws.cell(row, i, v); c.border = box; c.font = Font(size=10)
        if i in (4, 5, 6):
            c.number_format = UGX
        if i in (7, 8):
            c.number_format = PCT
        if i == 3:
            c.alignment = Alignment(wrap_text=True, vertical='top')
    row += 1
ws.auto_filter.ref = f'A5:H{row - 1}'
ws.sheet_properties.tabColor = '9C0006'

wb.save(OUT)
print('saved', OUT)
print('sheets:', wb.sheetnames)
print('products:', len(rows))
