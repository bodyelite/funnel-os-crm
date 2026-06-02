#!/usr/bin/env python3
import urllib.request, urllib.error, json, sys, getpass

BASE = "https://body-elite-giftcards.onrender.com"

def call(method, path, token, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json", "X-Auth-Token": token},
        method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

print("FunnelOS — Wipe de Leads")
print("="*40)

username = input("Usuario admin: ").strip() or "gerente"
password = getpass.getpass("Contraseña: ")
tenant   = input("Tenant [demo_automotora]: ").strip() or "demo_automotora"

print("\nAutenticando...")
login = call("POST", "/api/auth/login", "", {"username": username, "password": password, "tenant": tenant})

if "token" not in login:
    print("ERROR:", login.get("error", "Login fallido"))
    sys.exit(1)

token = login["token"]
print(f"✓ Sesión iniciada como {login['user']['name']}")

leads = call("GET", "/api/leads", token)
if not isinstance(leads, list):
    print("ERROR al obtener leads:", leads)
    sys.exit(1)

total = len(leads)
print(f"\nLeads encontrados: {total}")

if total == 0:
    print("✓ La base ya está vacía.")
    sys.exit(0)

confirm = input(f"\n¿Eliminar los {total} leads de '{tenant}'? Escribe CONFIRMAR: ").strip()
if confirm != "CONFIRMAR":
    print("Operación cancelada.")
    sys.exit(0)

wipe = call("DELETE", f"/api/leads/wipe?all=false", token)
if wipe.get("ok"):
    print(f"\n✅ Wipe completado. Leads eliminados: {wipe.get('deleted', total)}")
else:
    print("WARN: endpoint wipe no disponible. Procediendo lead por lead...")
    deleted = 0
    errors  = 0
    for l in leads:
        r = call("PATCH", f"/api/leads/{l['id']}", token, {"status": "_delete_"})
        if r.get("ok") or r.get("deleted"):
            deleted += 1
        else:
            errors += 1
        print(f"\r  Progreso: {deleted + errors}/{total}", end="", flush=True)
    print(f"\n✅ Eliminados: {deleted} | Errores: {errors}")

print("\nVerificando...")
check = call("GET", "/api/leads", token)
remaining = len(check) if isinstance(check, list) else "?"
print(f"Leads restantes: {remaining}")
print("Done.")
