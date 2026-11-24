"""Print semantic Office contents using independent readers."""
import sys,json
from pathlib import Path
p=Path(sys.argv[1])
if p.suffix=='.docx':
 from docx import Document
 d=Document(p)
 print(json.dumps({'paragraphs':[x.text for x in d.paragraphs],'tables':[[[c.text for c in r.cells] for r in t.rows] for t in d.tables],'images':len(d.inline_shapes),'header':d.sections[0].header.paragraphs[0].text,'footer':d.sections[0].footer.paragraphs[0].text,'bold':[r.text for x in d.paragraphs for r in x.runs if r.bold]},ensure_ascii=False))
elif p.suffix=='.xlsx':
 from openpyxl import load_workbook
 w=load_workbook(p)
 s=w['Sales'];dv=list(s.data_validations.dataValidation)
 print(json.dumps({'sheets':w.sheetnames,'score':s['B2'].value,'formula':s['D2'].value,'dateFormat':s['C2'].number_format,'bold':s['A1'].font.b,'fill':s['A1'].fill.fgColor.rgb,'hyperlink':s['A2'].hyperlink.target if s['A2'].hyperlink else None,'merges':[str(x) for x in s.merged_cells],'freeze':s.freeze_panes,'validation':[{'type':x.type,'min':x.formula1,'max':x.formula2,'range':str(x.sqref)} for x in dv],'tables':list(s.tables),'defined':list(w.defined_names),'cf':len(s.conditional_formatting),'images':len(s._images)}))
elif p.suffix=='.pdf' or p.read_bytes().startswith(b'%PDF-'):
 from pypdf import PdfReader
 r=PdfReader(p);print(json.dumps({'pages':len(r.pages),'images':sum(len(p.images) for p in r.pages),'text':'\n'.join(x.extract_text() for x in r.pages)},ensure_ascii=False))
