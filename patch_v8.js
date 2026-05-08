const fs = require('fs');

const NEW_STAGES = ['Nuevo', 'En Proceso', 'Agendado', 'Seguimiento', 'Cerrado', 'Abandonado'];
const cfgPath = './data/config.json';
try {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  let changed = false;
  for (const tenant of Object.keys(cfg)) {
    if (JSON.stringify(cfg[tenant].stages) !== JSON.stringify(NEW_STAGES)) {
      cfg[tenant].stages = NEW_STAGES;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    console.log('✓ config.json — stages actualizados');
  } else {
    console.log('· config.json — stages ya estaban al día');
  }
} catch (e) {
  console.warn('⚠ config.json no encontrado o inválido:', e.message);
}

let html = fs.readFileSync('./public/index.html', 'utf8');

html = html.replace(
`.kcol[data-s="Nuevo"] .kcol-name::before { background: var(--info); }
.kcol[data-s="Contactado"] .kcol-name::before { background: var(--warning); }
.kcol[data-s="Calificado"] .kcol-name::before { background: var(--accent); }
.kcol[data-s="Negociación"] .kcol-name::before, .kcol[data-s="Agendado"] .kcol-name::before { background: var(--purple); }
.kcol[data-s="Atendido"] .kcol-name::before { background: var(--accent); }
.kcol[data-s="Cerrado"] .kcol-name::before { background: var(--success); }
.kcol[data-s="Perdido"] .kcol-name::before { background: var(--danger); }`,
`.kcol[data-s="Nuevo"] .kcol-name::before { background: var(--info); }
.kcol[data-s="En Proceso"] .kcol-name::before { background: var(--warning); }
.kcol[data-s="Agendado"] .kcol-name::before { background: var(--purple); }
.kcol[data-s="Seguimiento"] .kcol-name::before { background: #b45309; }
.kcol[data-s="Cerrado"] .kcol-name::before { background: var(--success); }
.kcol[data-s="Abandonado"] .kcol-name::before { background: var(--danger); }`
);

html = html.replace(
`      // Agrupar por vendedor
      const byVendor = {};
      items.forEach(x => {
        const k = x.assignedTo || 'sin-asignar';
        if (!byVendor[k]) byVendor[k] = { name: x.assignedTo || 'Sin asignar', leads: [] };
        byVendor[k].leads.push(x);
      });
      const rows = Object.values(byVendor).sort((a, b) => b.leads.length - a.leads.length);

      sec.querySelector('#alertList').innerHTML = \`<div class="sla-accordion">\${
        rows.map((v, i) => {
          const danger  = v.leads.filter(x => slaClass(x) === 'critical').length;
          const risk    = v.leads.filter(x => slaClass(x) === 'risk').length;
          const fresh   = v.leads.filter(x => slaClass(x) === 'fresh').length;
          const pFresh    = fresh    > 0 ? '' : 'zero';
          const pRisk     = risk     > 0 ? '' : 'zero';
          const pCritical = danger   > 0 ? '' : 'zero';
          return \`<div class="sla-vendor" id="sv-\${i}">
            <button class="sla-vendor-head" onclick="toggleSV('\${i}')">
              <div class="sv-av">\${initials(v.name)}</div>
              <div>
                <div class="sv-name">\${escape(v.name)}</div>
                <div class="sv-sub">\${v.leads.length} lead\${v.leads.length !== 1 ? 's' : ''} en esta vista</div>
              </div>
              <div class="sv-sla-pills">
                <span class="sv-pill critical \${pCritical}">🔴 \${danger}</span>
                <span class="sv-pill risk \${pRisk}">🟡 \${risk}</span>
                <span class="sv-pill fresh \${pFresh}">🟢 \${fresh}</span>
              </div>
              <span class="sv-count">\${v.leads.length}</span>
              <span class="sv-chevron">▼</span>
            </button>
            <div class="sv-body" id="svb-\${i}">
              <div class="sv-leads">
                \${v.leads.sort((a,b) => calcMin(b.lastInteraction) - calcMin(a.lastInteraction)).map(renderLeadRow).join('')}
              </div>
            </div>
          </div>\`;
        }).join('')
      }</div>\`;

      // Auto-abrir el primer vendedor si hay críticos
      if (rows.length && rows[0].leads.some(x => slaClass(x) === 'critical')) {
        toggleSV('0');
      }`,

`      // Bug 3: nombre real del vendedor buscado en t (team data)
      const byVendor = {};
      items.forEach(x => {
        const k = x.assignedTo || '__none__';
        if (!byVendor[k]) {
          const teamMember = t.find(v => v.username === x.assignedTo);
          byVendor[k] = { name: teamMember ? teamMember.name : (x.assignedTo || 'Sin asignar'), leads: [] };
        }
        byVendor[k].leads.push(x);
      });
      const rows = Object.values(byVendor).sort((a, b) => b.leads.length - a.leads.length);

      sec.querySelector('#alertList').innerHTML = \`<div class="sla-accordion">\${
        rows.map((v, i) => {
          const svId    = 'sv-' + i;
          const danger  = v.leads.filter(x => slaClass(x) === 'critical').length;
          const risk    = v.leads.filter(x => slaClass(x) === 'risk').length;
          const fresh   = v.leads.filter(x => slaClass(x) === 'fresh').length;
          const pFresh    = fresh  > 0 ? '' : 'zero';
          const pRisk     = risk   > 0 ? '' : 'zero';
          const pCritical = danger > 0 ? '' : 'zero';
          // Bug 4: tiempo promedio de espera de los leads en esta vista
          const avgMin = v.leads.length
            ? Math.round(v.leads.reduce((s, x) => s + calcMin(x.lastInteraction), 0) / v.leads.length)
            : 0;
          // Bug 2: restaurar estado abierto si el acordeón estaba abierto antes del refresh
          const wasOpen = (window.openAccordionIds || new Set()).has(svId);
          return \`<div class="sla-vendor" id="\${svId}">
            <button class="sla-vendor-head \${wasOpen ? 'open' : ''}" onclick="toggleSV('\${svId}')">
              <div class="sv-av">\${initials(v.name)}</div>
              <div>
                <div class="sv-name">\${escape(v.name)}</div>
                <div class="sv-sub">\${v.leads.length} lead\${v.leads.length !== 1 ? 's' : ''} · ⏱ prom \${avgMin}m</div>
              </div>
              <div class="sv-sla-pills">
                <span class="sv-pill critical \${pCritical}">🔴 \${danger}</span>
                <span class="sv-pill risk \${pRisk}">🟡 \${risk}</span>
                <span class="sv-pill fresh \${pFresh}">🟢 \${fresh}</span>
              </div>
              <span class="sv-count">\${v.leads.length}</span>
              <span class="sv-chevron">▼</span>
            </button>
            <div class="sv-body \${wasOpen ? 'open' : ''}" id="svb-\${svId}">
              <div class="sv-leads">
                \${v.leads.sort((a,b) => calcMin(b.lastInteraction) - calcMin(a.lastInteraction)).map(renderLeadRow).join('')}
              </div>
            </div>
          </div>\`;
        }).join('')
      }</div>\`;

      // Auto-abrir críticos solo si no había estado previo guardado
      const hasState = window.openAccordionIds && window.openAccordionIds.size > 0;
      if (!hasState && rows.length && rows[0].leads.some(x => slaClass(x) === 'critical')) {
        toggleSV('sv-0');
      }`
);

html = html.replace(
  `                <div class="sv-sub">\${v.total} leads · \${v.byStatus.cerrado} cerrados</div>`,
  `                <div class="sv-sub">\${v.total} leads · \${v.byStatus.cerrado} cerrados · ⏱ prom \${v.avgResp || 0}m</div>`
);

html = html.replace(
`function toggleSV(id) {
  const head = document.querySelector(\`[onclick="toggleSV('\${id}')"]\`);
  const body = document.getElementById('svb-' + id);
  if (!head || !body) return;
  const open = body.classList.contains('open');
  body.classList.toggle('open', !open);
  head.classList.toggle('open', !open);
}`,
`function toggleSV(id) {
  const head = document.querySelector(\`[onclick="toggleSV('\${id}')"]\`);
  const body = document.getElementById('svb-' + id);
  if (!head || !body) return;
  const open = body.classList.contains('open');
  body.classList.toggle('open', !open);
  head.classList.toggle('open', !open);
  if (!window.openAccordionIds) window.openAccordionIds = new Set();
  if (!open) window.openAccordionIds.add(id);
  else window.openAccordionIds.delete(id);
}`
);

fs.writeFileSync('./public/index.html', html);
console.log('✓ public/index.html — 5 bugs corregidos');

const checks = [
  ['Bug 5 CSS kcol',      'kcol[data-s="En Proceso"]'],
  ['Bug 3 nombre real',   'teamMember ? teamMember.name'],
  ['Bug 4 avgMin acord',  'prom ${avgMin}m'],
  ['Bug 4 avgResp rank',  'prom ${v.avgResp || 0}m'],
  ['Bug 2 openAccordion', 'window.openAccordionIds'],
];
let ok = true;
const final = fs.readFileSync('./public/index.html', 'utf8');
for (const [label, needle] of checks) {
  if (!final.includes(needle)) {
    console.error(`✗ FALLO: ${label} — "${needle}" no encontrado`);
    ok = false;
  }
}
if (ok) console.log('✅ patch_v8 completado sin errores');
else process.exit(1);
