# -*- coding: utf-8 -*-
# patch_sprint2_fix.py — 3 patches quirúrgicos sobre el index.html actual
# python3 patch_sprint2_fix.py

import re, sys, subprocess

HTM = 'public/index.html'
src = open(HTM, 'r', encoding='utf-8').read()

def apply(label, old, new):
    global src
    if old not in src:
        print('FALLO [' + label + ']'); sys.exit(1)
    src = src.replace(old, new, 1)
    print('OK [' + label + ']')

# ── P1: renderModal — mostrar selector vendedor para admin ────────────────────
apply('P1 selector vendedor en modal',
    'renderModalCtx(l);renderModalChat(l);renderModalNotes(l);}',
    'renderModalCtx(l);renderModalChat(l);renderModalNotes(l);'
    'var _ab=$("mAssignBlock"),_ms=$("mAssign");'
    'if(_ab&&S.user&&S.user.role==="admin"){'
    '_ab.style.display="block";'
    '_ms.innerHTML=(S.users||[]).filter(function(u){return u.role==="vendedor";}).map(function(u){'
    'return\'<option value="\'+esc(u.username)+\'"\'+(u.username===l.assignedTo?\' selected\':\'\')+\'>\'+esc(u.name)+\'</option>\';'
    '}).join("");'
    '}else if(_ab){_ab.style.display="none";}'
    '}'
)

# ── P2: mSv — enviar assignedTo al guardar (solo admin) ──────────────────────
apply('P2 assignedTo en payload',
    'payload.status=st;if(note)payload.note=note;',
    'payload.status=st;'
    'if(S.user&&S.user.role==="admin"){'
    'var _a=$("mAssign");'
    'if(_a&&_a.value&&_a.value!==l?.assignedTo)payload.assignedTo=_a.value;'
    '}'
    'if(note)payload.note=note;'
)

# ── P3: .mo mobile — anclar al pie como bottom sheet ─────────────────────────
apply('P3 modal bottom sheet mobile',
    '.mo{width:100%;max-width:100%;border-radius:16px 16px 0 0;max-height:96vh;margin:0;overflow:hidden}',
    '.mo{width:100%!important;max-width:100%!important;border-radius:16px 16px 0 0;max-height:92vh!important;margin:0!important;position:fixed;bottom:0;left:0;right:0;overflow:hidden}'
)

open(HTM, 'w', encoding='utf-8').write(src)

tag = re.search(r'<script>(.*?)</script>', src, re.DOTALL)
open('/tmp/_fix_check.js', 'w', encoding='utf-8').write(tag.group(1))
r = subprocess.run(['node','--check','/tmp/_fix_check.js'], capture_output=True, text=True)
if r.returncode != 0:
    print('ERROR JS:\n' + r.stderr); sys.exit(1)

print('Sintaxis OK')
print('\ngit add public/index.html && git commit -m "fix: selector vendedor + mobile modal + assignedTo" && git push')
