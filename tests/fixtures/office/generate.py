"""Independent Office fixtures: python-docx/openpyxl; never imports application code."""
from pathlib import Path
import base64,json,zlib,struct,binascii
from docx import Document
from docx.shared import Inches,Pt,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from openpyxl import Workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table,TableStyleInfo
from openpyxl.formatting.rule import CellIsRule
from openpyxl.workbook.defined_name import DefinedName
out=Path(__file__).parent
def chunk(tag,data):
 return struct.pack('>I',len(data))+tag+data+struct.pack('>I',binascii.crc32(tag+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',32,20,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(b'\0'+bytes([20+y*3,100,200])*32 for y in range(20))))+chunk(b'IEND',b'')

(out/'pixel.png').write_bytes(png)
d=Document();d.core_properties.title='Independent document'
sec=d.sections[0];sec.header.paragraphs[0].text='Team header';sec.footer.paragraphs[0].text='Private footer'
d.add_heading('Отчёт Pioneer',0);d.add_heading('Summary',1)
p=d.add_paragraph();p.add_run('Hello ').bold=True;p.add_run('коллеги').italic=True
link=OxmlElement('w:hyperlink');link.set(qn('r:id'),p.part.relate_to('https://example.com',RT.HYPERLINK,is_external=True));r=OxmlElement('w:r');t=OxmlElement('w:t');t.text=' website';r.append(t);link.append(r);p._p.append(link)
d.add_paragraph('First item',style='List Bullet');d.add_paragraph('Second item',style='List Bullet')
table=d.add_table(rows=2,cols=2);table.cell(0,0).text='Name';table.cell(0,1).text='Score';table.cell(1,0).text='Иван';table.cell(1,1).text='42'
d.add_picture(str(out/'pixel.png'),width=Inches(.5))
d.add_paragraph('Final paragraph')
d.save(out/'independent.docx')
w=Workbook();s=w.active;s.title='Sales';s.append(['Name','Score','Date']);s.append(['Иван',42,45352]);s.append(['Mary',18,45353]);s['D2']='=B2*2';s['D3']=True;s['B2'].number_format='0.00';s['C2'].number_format='yyyy-mm-dd'
s['A1'].font=Font(bold=True,color='FFFFFF');s['A1'].fill=PatternFill('solid',fgColor='123456');s['A1'].alignment=Alignment(horizontal='center',wrap_text=True)
s['A2'].hyperlink='https://example.com';s.freeze_panes='B2';s.row_dimensions[2].height=26;s.column_dimensions['A'].width=23;s.column_dimensions['E'].hidden=True
s['A6']='Merged';s.merge_cells('A6:C6')
dv=DataValidation(type='whole',operator='between',formula1=0,formula2=100);dv.error='Only scores';dv.errorTitle='Invalid score';dv.showErrorMessage=True;s.add_data_validation(dv);dv.add('B2:B3')
s.conditional_formatting.add('B2:B3',CellIsRule(operator='greaterThan',formula=['20'],fill=PatternFill('solid',fgColor='FF0000')))
tab=Table(displayName='Scores',ref='A1:C3');tab.tableStyleInfo=TableStyleInfo(name='TableStyleMedium2',showRowStripes=True);s.add_table(tab)
w.defined_names.add(DefinedName('ScoresRange',attr_text="'Sales'!$B$2:$B$3"))
other=w.create_sheet('Other');other['A1']='Second worksheet';other['A2']=100
from openpyxl.drawing.image import Image
im=Image(out/'pixel.png');im.width=80;im.height=50;s.add_image(im,'G2')
w.save(out/'independent.xlsx')
(out/'quoted.csv').write_bytes('\ufeffname,description,formula\r\nИван,"line 1\nline ""2""",=2+2\r\n'.encode())
