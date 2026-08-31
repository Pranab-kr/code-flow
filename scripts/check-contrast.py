import math
def srgb(L,C,H):
    h=math.radians(H); a=C*math.cos(h); b=C*math.sin(h)
    l=(L+0.3963377774*a+0.2158037573*b)**3
    m=(L-0.1055613458*a-0.0638541728*b)**3
    s=(L-0.0894841775*a-1.2914855480*b)**3
    return [max(0.,min(1.,v)) for v in (4.0767416621*l-3.3077115913*m+0.2309699292*s,
        -1.2684380046*l+2.6097574011*m-0.3413193965*s,
        -0.0041960863*l-0.7034186147*m+1.7076147010*s)]
def lum(c): r,g,b=srgb(*c); return .2126*r+.7152*g+.0722*b
def ratio(a,b):
    x,y=lum(a),lum(b); hi,lo=max(x,y),min(x,y); return (hi+.05)/(lo+.05)

DAY=dict(paper=(.97,.006,200),paper_2=(.94,.008,200),paper_3=(.90,.010,200),
 ink=(.22,.015,200),ink_2=(.49,.012,200),ink_3=(.49,.010,200),
 accent=(.49,.135,200),accent_ink=(.99,.002,200),rule=(.80,.008,200),focus=(.55,.150,200),
 danger=(.56,.170,25),warn=(.55,.130,70),ok=(.53,.120,150),
 canvas=(.95,.005,200),node=(.99,.002,200),node_brdr=(.62,.010,200),
 edge=(.62,.012,200),edge_back=(.63,.100,300))
NIGHT=dict(paper=(.16,.018,240),paper_2=(.21,.020,240),paper_3=(.26,.022,240),
 ink=(.95,.006,200),ink_2=(.78,.008,200),ink_3=(.64,.010,200),
 accent=(.74,.135,200),accent_ink=(.16,.018,240),rule=(.38,.016,240),focus=(.78,.140,200),
 danger=(.70,.150,25),warn=(.78,.120,70),ok=(.74,.110,150),
 canvas=(.13,.016,240),node=(.20,.020,240),node_brdr=(.50,.018,240),
 edge=(.55,.014,220),edge_back=(.66,.110,300))

P=[('ink','paper',4.5),('ink','paper_2',4.5),('ink','paper_3',4.5),('ink','node',4.5),
 ('ink_2','paper',4.5),('ink_2','paper_2',4.5),('ink_2','paper_3',4.5),('ink_2','node',4.5),
 ('ink_3','paper',4.5),('ink_3','paper_2',4.5),('ink_3','paper_3',4.5),('ink_3','node',4.5),
 ('accent','paper',4.5),('accent','paper_2',4.5),('accent','node',4.5),
 ('accent_ink','accent',4.5),
 ('focus','paper',3.),('focus','paper_2',3.),('focus','paper_3',3.),('focus','canvas',3.),
 ('node_brdr','canvas',3.),('node_brdr','node',3.),
 ('edge','canvas',3.),('edge_back','canvas',3.),
 ('danger','paper',4.5),('warn','paper',4.5),('ok','paper',4.5)]

bad=0
for nm,T in (('AURORA DAY (light)',DAY),('AURORA NIGHT (dark)',NIGHT)):
    print('\n=== %s ==='%nm); f=0
    for fg,bg,need in P:
        r=ratio(T[fg],T[bg])
        if r<need: f+=1; bad+=1; print('  FAIL %-24s %5.2f  need %.1f'%(fg+' on '+bg,r,need))
    print('  %d/%d pass'%(len(P)-f,len(P)))
print('\n%s'%('*** ALL 27 GATES PASS IN BOTH THEMES ***' if bad==0 else '*** %d FAILURES ***'%bad))
print('rule = decorative divider, exempt from 1.4.11: day %.2f night %.2f'%(
    ratio(DAY['rule'],DAY['paper']),ratio(NIGHT['rule'],NIGHT['paper'])))

# ---------------------------------------------------------------------------
# Usage:  python3 scripts/check-contrast.py
#
# Source of truth is src/styles/tokens.css. Keep the DAY/NIGHT dicts above in
# sync with it whenever an L value changes, then re-run.
#
# NOTE: Lightning CSS downlevels OKLCH to hex at build time, so the values the
# browser receives are NOT byte-identical to the OKLCH source. After `pnpm
# build`, the shipped hex was independently re-checked and also passes 27/27.
# If you change a token, verify BOTH: this script and the built CSS.
# ---------------------------------------------------------------------------
