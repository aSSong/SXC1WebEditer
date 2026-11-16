"""Assemble the dependency-free, single-file page."""
import argparse
import json
from pathlib import Path
root=Path(__file__).resolve().parent
ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=root.parent/'index.html');args=ap.parse_args()
html=(root/'page.html').read_text(encoding='utf-8')
for marker,name in [('STYLE','style.css'),('I18N','i18n.js'),('CORE','core.js'),('UPLOAD','upload.js'),('PAD','pad.js'),('BATCH','batch.js'),('BACKUP','backup.js'),('APP','app.js'),('UPLOAD_UI','upload-ui.js'),('PAD_UI','pad-ui.js'),('BATCH_UI','batch-ui.js'),('BACKUP_UI','backup-ui.js')]:
    content=(root/name).read_text(encoding='utf-8')
    if marker=='I18N':
        messages=json.loads((root/'locales/en.json').read_text(encoding='utf-8'))
        catalog=json.dumps(messages,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
        content=content.replace('/*EN_MESSAGES*/{}',catalog)
    html=html.replace('/*'+marker+'*/',content)
args.output.write_text(html,encoding='utf-8')
