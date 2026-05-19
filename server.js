import express    from 'express';
import cors        from 'cors';
import fs          from 'fs';
import path        from 'path';
import dotenv      from 'dotenv';

import {
    getSessions, getBotStatus,
    toggleBot, updateTag,
    marcarLeido, marcarNoLeido, eliminarCliente,
    crearClienteManual,
    enviarMensajeManual, enviarImagenManual, enviarPlantillaManual,
    agregarNota, eliminarNota,
    forzarRecalculo, procesarPushBatch,
    procesarEvento,
} from './app.js';

import { NEGOCIO }         from './config/business.js';
import { iniciarCron }     from './cron.js';
import { log, getRecentLogs, getAttributionRecords } from './logger.js';

dotenv.config();

const app      = express();
const DATA_DIR = path.join(process.cwd(), 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const PUBLIC_DIR = path.join(process.cwd(), 'src', 'public');

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use('/media', express.static(MEDIA_DIR));

// ── Monitor ───────────────────────────────────────────────────────────────────
app.get('/monitor', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'monitor.html')));
app.get('/bi',      (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bi.html')));

// ── Data endpoints ────────────────────────────────────────────────────────────
app.get('/api/data', (_req, res) => {
    res.json({ users: getSessions(), botStatus: getBotStatus() });
});

app.get('/api/attribution', (_req, res) => {
    res.json(getAttributionRecords());
});

app.get('/api/logs', (_req, res) => {
    const limit = parseInt(_req.query.limit) || 200;
    res.json(getRecentLogs(limit));
});

// ── CSV export ────────────────────────────────────────────────────────────────
app.get('/api/export-csv', (_req, res) => {
    const sessions = getSessions();
    const BOM = '\uFEFF';
    const COLS = ['Fecha','Telefono','Nombre','Estado','Origen','Campaña','Ad ID','Ad Title','CTWA CLID','Referral Source','Primer Mensaje','Notas'];
    const fmt = new Intl.DateTimeFormat('es-CL', { timeZone:'America/Santiago', day:'2-digit', month:'2-digit', year:'numeric' });

    const escape = (v) => `"${String(v ?? '').replace(/"/g,'""').replace(/\n/g,' ')}"`;

    const rows = Object.entries(sessions).map(([phone, u]) => {
        const firstMsg = (u.history ?? []).find(m => m.role === 'user');
        const fecha    = fmt.format(new Date(firstMsg?.timestamp ?? u.lastInteraction ?? Date.now())).replace(/\//g, '-');
        const notes    = (u.notes ?? []).map(n => n.text).join(' | ');
        return [
            fecha, u.phone || phone, u.name || 'Cliente', u.tag || 'NUEVO',
            u.origin || '', u.campaign || '', u.ad_id || '', u.ad_title || '',
            u.ctwa_clid || '', u.referral_source || '',
            firstMsg?.content || '', notes,
        ].map(escape).join(';');
    });

    const csv = BOM + COLS.map(c => `"${c}"`).join(';') + '\n' + rows.join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename=ZARA2_META_EXPORT.csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(csv);
});

app.get('/api/download-json', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename=ZARA2_DATA.json');
    res.json({ users: getSessions(), botStatus: getBotStatus() });
});


// ── BI: cruce Meta Ads × sesiones Zara × Reservo ────────────────────────────
app.post('/api/bi/cruce', (req, res) => {
    try {
        const body = req.body ?? {};
        const metaAds    = Array.isArray(body.metaAds)    ? body.metaAds    : [];
        const reservoRows= Array.isArray(body.reservoRows) ? body.reservoRows: [];
        const fechaDesde = body.fechaDesde || '';
        const fechaHasta = body.fechaHasta || '';

        const desde = fechaDesde ? new Date(fechaDesde).getTime() : 0;
        const hasta = fechaHasta ? new Date(fechaHasta).getTime() + 86400000 : Infinity;

        // Limpia un número que puede llegar como string con puntos, comas o símbolos
        function limpiarMonto(v) {
            if (v === null || v === undefined || v === '') return 0;
            const n = parseFloat(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.'));
            return isFinite(n) ? n : 0;
        }

        // Normaliza un teléfono a solo dígitos, manejando notación científica de JS
        function limpiarPhone(v) {
            if (v === null || v === undefined) return '';
            // SheetJS puede entregar números grandes como 5.699e+10
            let s = typeof v === 'number' ? Math.round(v).toString() : String(v);
            return s.replace(/[^0-9]/g, '');
        }

        // Normaliza una fecha que puede llegar como string ISO, Date, o número Excel
        function limpiarFecha(v) {
            if (!v) return 0;
            if (v instanceof Date) return isNaN(v) ? 0 : v.getTime();
            if (typeof v === 'number') {
                // Número serial de Excel: días desde 1900-01-01
                if (v > 1000 && v < 100000) {
                    const ms = (v - 25569) * 86400000;
                    return isFinite(ms) ? ms : 0;
                }
                return v; // ya es ms epoch
            }
            const d = new Date(String(v).trim());
            return isNaN(d) ? 0 : d.getTime();
        }

        // ── Indexar sesiones Zara ────────────────────────────────────────────
        const sessions    = getSessions() ?? {};
        const zaraByPhone = {};
        for (const [phone, s] of Object.entries(sessions)) {
            if (!s || typeof s !== 'object') continue;
            zaraByPhone[String(phone).replace(/[^0-9]/g, '')] = s;
        }

        // ── Construir mapa de anuncios desde Meta ────────────────────────────
        const adMap = {};
        for (const ad of metaAds) {
            if (!ad || typeof ad !== 'object') continue;
            const id = String(ad.ad_id ?? '').trim();
            if (!id || id === 'undefined' || id === 'null') continue;
            adMap[id] = {
                ad_id:        id,
                ad_name:      String(ad.ad_name ?? '').trim(),
                inversion:    limpiarMonto(ad.inversion),
                dias_activo:  Math.max(1, parseInt(ad.dias_activo) || 1),
                leads:        0,
                agendados:    0,
                atendidos:    0,
                suspendidos:  0,
            };
        }

        // ── Cruzar sesiones Zara → anuncio por ad_id ─────────────────────────
        for (const [phone, s] of Object.entries(zaraByPhone)) {
            if (!s || typeof s !== 'object') continue;
            const adId = String(s.ad_id ?? '').trim();
            if (!adId || !adMap[adId]) continue;
            const firstContact = s.history?.[0]?.timestamp ?? 0;
            if (desde && firstContact && firstContact < desde) continue;
            if (hasta !== Infinity && firstContact && firstContact > hasta) continue;
            adMap[adId].leads++;
            const tag = String(s.tag ?? '');
            if (tag === 'AGENDADO' || tag === 'NO ASISTIDOS') adMap[adId].agendados++;
        }

        // ── Cruzar Reservo → Zara → anuncio por teléfono ────────────────────
        const VENTANA = 60 * 24 * 60 * 60 * 1000;
        for (const row of reservoRows) {
            if (!row || typeof row !== 'object') continue;
            const phone = limpiarPhone(row.telefono ?? '');
            if (!phone || phone.length < 8) continue;
            const zaraSession = zaraByPhone[phone];
            if (!zaraSession || typeof zaraSession !== 'object') continue;
            const adId = String(zaraSession.ad_id ?? '').trim();
            if (!adId || !adMap[adId]) continue;
            const firstContact   = zaraSession.history?.[0]?.timestamp ?? 0;
            const reservoFechaMs = limpiarFecha(row.fecha);
            if (firstContact && reservoFechaMs) {
                if (reservoFechaMs < firstContact) continue;
                if (reservoFechaMs > firstContact + VENTANA) continue;
            }
            const estado = String(row.estado ?? '').trim();
            if (estado === 'Atendido')  adMap[adId].atendidos++;
            if (estado === 'Suspendió') adMap[adId].suspendidos++;
        }

        // ── Calcular KPIs derivados ──────────────────────────────────────────
        const reporte = Object.values(adMap).map(a => {
            const dias = Math.max(a.dias_activo, 1);
            const safe = (num, den) => den > 0 ? +(num / den).toFixed(2) : null;
            return {
                ad_id:             a.ad_id,
                ad_name:           a.ad_name,
                inversion:         a.inversion,
                dias_activo:       a.dias_activo,
                leads:             a.leads,
                agendados:         a.agendados,
                atendidos:         a.atendidos,
                suspendidos:       a.suspendidos,
                cpl:               a.leads     > 0 ? Math.round(a.inversion / a.leads)     : null,
                cpa:               a.agendados > 0 ? Math.round(a.inversion / a.agendados) : null,
                tasa_asistencia:   safe(a.atendidos * 100, a.agendados),
                leads_por_dia:     safe(a.leads,     dias),
                inversion_por_dia: Math.round(a.inversion / dias),
            };
        }).sort((a, b) => (b.leads ?? 0) - (a.leads ?? 0));

        log.info('bi_cruce_ok', { ads: reporte.length, leads: reporte.reduce((s,r)=>s+(r.leads||0),0) });
        res.json({ ok: true, reporte });

    } catch (e) {
        log.error('bi_cruce_failed', { error: e.message, stack: e.stack });
        res.status(500).json({ ok: false, error: e.message, stack: e.stack });
    }
});

// ── Bot control ───────────────────────────────────────────────────────────────
app.post('/api/bot',    (req, res) => { toggleBot(req.body.phone); res.json({ ok: true }); });

// ── Messaging ─────────────────────────────────────────────────────────────────
app.post('/api/manual', async (req, res) => {
    const ok = await enviarMensajeManual(req.body.phone, req.body.text);
    res.json({ ok });
});

app.post('/api/template', async (req, res) => {
    const result = await enviarPlantillaManual(req.body.phone, req.body.template);
    res.json(result);
});

app.post('/api/manual-image', async (req, res) => {
    try {
        const { phone, text, imageBase64, filename } = req.body;
        const buffer   = Buffer.from(imageBase64.split(',')[1], 'base64');
        const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9.]/g, '')}`;
        const filepath = path.join(MEDIA_DIR, safeName);
        fs.writeFileSync(filepath, buffer);

        const host     = req.get('host');
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const url      = `${protocol}://${host}/media/${safeName}`;

        const ok = await enviarImagenManual(phone, text, url);
        res.json({ ok });
    } catch (e) {
        log.error('api_manual_image', { error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// ── CRM operations ────────────────────────────────────────────────────────────
app.post('/api/new-chat',     (req, res) => res.json({ ok: crearClienteManual(req.body.phone, req.body.name) }));
app.post('/api/tag',          (req, res) => { updateTag(req.body.phone, req.body.tag); res.json({ ok: true }); });
app.post('/api/leido',        (req, res) => { marcarLeido(req.body.phone); res.json({ ok: true }); });
app.post('/api/unread',       (req, res) => { marcarNoLeido(req.body.phone); res.json({ ok: true }); });
app.post('/api/delete-client',(req, res) => { eliminarCliente(req.body.phone); res.json({ ok: true }); });
app.get( '/api/recalc',       (_req, res) => res.json({ count: forzarRecalculo() }));

// ── Notes ─────────────────────────────────────────────────────────────────────
app.post('/api/note',         (req, res) => { agregarNota(req.body.phone, req.body.text, req.body.isScheduled, req.body.targetDate); res.json({ ok: true }); });
app.post('/api/delete-note',  (req, res) => { eliminarNota(req.body.phone, req.body.index); res.json({ ok: true }); });

// ── Push batch ────────────────────────────────────────────────────────────────
app.post('/api/push-batch', async (req, res) => {
    try {
        const list  = req.body.raw.split('\n').filter(r => r.trim()).map(r => {
            const [nombre, telefono, ...rest] = r.split('|');
            return { nombre: nombre?.trim(), telefono: telefono?.trim(), mensaje: rest.join('|').trim() };
        });
        const count = await procesarPushBatch(list);
        res.json({ count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Meta webhook ──────────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === NEGOCIO.webhook_verify_token) {
        log.info('webhook_verified');
        res.send(req.query['hub.challenge']);
    } else {
        log.warn('webhook_verify_failed', { token: req.query['hub.verify_token'] });
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    try {
        await procesarEvento(req.body);
        res.sendStatus(200);
    } catch (e) {
        log.error('webhook_processing_error', { error: e.message });
        res.sendStatus(500);
    }
});

// ── Logs view ─────────────────────────────────────────────────────────────────
app.get('/auditoria', (_req, res) => {
    const logs = getRecentLogs(300);
    const rows = logs.map(l => `
        <tr style="border-bottom:1px solid #1e2030">
            <td style="color:#64748b;white-space:nowrap;padding:4px 10px">${l.ts}</td>
            <td style="padding:4px 10px"><span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;background:${l.level==='ERROR'?'#450a0a':l.level==='WARN'?'#422006':'#0c1a2e'};color:${l.level==='ERROR'?'#fca5a5':l.level==='WARN'?'#fcd34d':'#93c5fd'}">${l.level}</span></td>
            <td style="color:#e2e8f0;padding:4px 10px">${l.event}</td>
            <td style="color:#94a3b8;padding:4px 10px;font-size:11px">${l.phone||''}</td>
            <td style="color:#64748b;padding:4px 10px;font-size:10px;font-family:monospace">${JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k])=>!['ts','level','event','phone'].includes(k))))}</td>
        </tr>`).join('');

    res.send(`<!DOCTYPE html><html><head><title>Auditoría — ZARA 2</title><meta charset="UTF-8"></head>
    <body style="background:#0f1117;color:#e2e8f0;font-family:Inter,sans-serif;font-size:12px;margin:0;padding:16px">
    <h2 style="margin-bottom:16px;color:#6366f1">🔍 Auditoría del sistema — ZARA 2</h2>
    <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1a1d27">
            <th style="text-align:left;padding:8px 10px;color:#64748b">Timestamp</th>
            <th style="text-align:left;padding:8px 10px;color:#64748b">Nivel</th>
            <th style="text-align:left;padding:8px 10px;color:#64748b">Evento</th>
            <th style="text-align:left;padding:8px 10px;color:#64748b">Teléfono</th>
            <th style="text-align:left;padding:8px 10px;color:#64748b">Datos</th>
        </tr></thead>
        <tbody>${rows}</tbody>
    </table>
    </body></html>`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { log.info('server_started', { port: PORT }); iniciarCron(); });
