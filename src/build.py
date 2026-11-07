"""Assemble the dependency-free, single-file page."""
import argparse
from pathlib import Path
root=Path(__file__).resolve().parent
ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=root.parent/'index.html');args=ap.parse_args()
html=(root/'page.html').read_text()
for marker,name in [('STYLE','style.css'),('CORE','core.js'),('UPLOAD','upload.js'),('PAD','pad.js'),('APP','app.js'),('UPLOAD_UI','upload-ui.js'),('PAD_UI','pad-ui.js')]:
    html=html.replace('/*'+marker+'*/',(root/name).read_text())
args.output.write_text(html)
