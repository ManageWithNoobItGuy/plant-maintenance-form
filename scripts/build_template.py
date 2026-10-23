"""Build src/template.json from the registered ISO Word form.

Takes the first motor table of the original check sheet, swaps the motor
specs and the 30 data rows for {{PLACEHOLDERS}}, and stores every other
part of the .docx so the Worker can rebuild an identical file.

Usage: python3 -I scripts/build_template.py template/checksheet-motor-original.docx src/template.json
"""
import json
import re
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src)
doc = z.read("word/document.xml").decode("utf-8")
doc = re.sub(r' w:rsid\w*="[^"]*"', "", doc)  # drop revision ids, shrinks the file a lot

i = doc.find("<w:tbl>")
j = doc.find("</w:tbl>") + len("</w:tbl>")
k = doc.find("<w:tbl>", j)
head, table, sep = doc[:i], doc[i:j], doc[j:k]
tail = doc[doc.rfind("</w:tbl>") + len("</w:tbl>"):]

rows = re.findall(r"<w:tr[ >].*?</w:tr>", table, re.S)
assert len(rows) == 41, len(rows)

FONT = '<w:rFonts w:ascii="Angsana New" w:eastAsia="Calibri" w:hAnsi="Angsana New" w:cs="Angsana New"/>'


def cells(row):
    return re.findall(r"<w:tc>.*?</w:tc>", row, re.S)


def spec_para(label, key, unit):
    run = lambda text, u=False: (
        f'<w:r><w:rPr>{FONT}{"<w:u w:val=\"dotted\"/>" if u else ""}</w:rPr>'
        f'<w:t xml:space="preserve">{text}</w:t></w:r>'
    )
    return (
        f'<w:p><w:pPr><w:rPr>{FONT}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr>'
        + run(label + " ")
        + run(" {{" + key + "}} ", True)
        + (run(" " + unit) if unit else "")
        + "</w:p>"
    )


SPECS = {
    1: [("Tag No", "TAG", ""), ("Tag Des.", "DESC", "")],
    2: [("Brand", "BRAND", ""), ("Type", "TYPE", "")],
    3: [("Power", "KW", "KW"), ("Voltage", "VOLT", "V")],
    4: [("Current", "AMP", "A"), ("Speed", "RPM", "RPM")],
    5: [("Connection", "CONN", ""), ("Plant", "PLANT", "")],
}


def replace_para(cell, new_para):
    return re.sub(r"<w:p>.*</w:p>", lambda _: new_para, cell, flags=re.S)


def fill_slot(cell, key, center=False):
    """Put a placeholder at the end of the cell's (empty) paragraph."""
    if center and "<w:jc " not in cell:
        cell = cell.replace("<w:pPr>", '<w:pPr><w:jc w:val="center"/>', 1)
    if "</w:pPr></w:p>" in cell:
        return cell.replace("</w:pPr></w:p>", "</w:pPr>{{" + key + "}}</w:p>", 1)
    return cell.replace("</w:p>", "{{" + key + "}}</w:p>", 1)


new_rows = []
for n, row in enumerate(rows):
    cs = cells(row)
    if n in SPECS:
        (l1, k1, u1), (l2, k2, u2) = SPECS[n]
        row = row.replace(cs[-2], replace_para(cs[-2], spec_para(l1, k1, u1)), 1)
        row = row.replace(cs[-1], replace_para(cs[-1], spec_para(l2, k2, u2)), 1)
    elif n == 8:  # blank cell under "วิศวกร" -> engineer name
        row = row.replace(cs[-1], fill_slot(cs[-1], "ENG_NAME", center=True), 1)
    elif n == 9:  # "......./......../........" -> approval date
        assert "......." in cs[-1]
        para = re.search(r"<w:p>.*</w:p>", cs[-1], re.S).group(0)
        ppr = re.search(r"<w:pPr>.*?</w:pPr>", para, re.S)
        new = "<w:p>" + (ppr.group(0) if ppr else "") + "{{ENG_DATE}}</w:p>"
        if "<w:jc " not in new:
            new = new.replace("<w:pPr>", '<w:pPr><w:jc w:val="center"/>', 1)
        row = row.replace(cs[-1], replace_para(cs[-1], new), 1)
    elif 11 <= n <= 40:  # data rows 1..30
        r = n - 10
        new = row
        for c, cell in enumerate(cs[1:], start=1):
            new = new.replace(cell, fill_slot(cell, f"R{r}C{c}", center=c <= 10), 1)
        row = new
    new_rows.append(row)

for old, new in zip(rows, new_rows):
    table = table.replace(old, new, 1)

for key in ["TAG", "DESC", "BRAND", "TYPE", "KW", "VOLT", "AMP", "RPM", "CONN", "PLANT", "ENG_NAME", "ENG_DATE", "R1C1", "R30C11"]:
    assert "{{" + key + "}}" in table, key

parts = {}
for name in z.namelist():
    if name != "word/document.xml":
        parts[name] = z.read(name).decode("utf-8")

json.dump({"head": head, "table": table, "sep": sep, "tail": tail, "parts": parts}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print("ok", len(table), "chars per table")
