import shutil, os
for src, dst in [("manifest.json","public/manifest.json"),("icon-192.svg","public/icon-192.svg"),("icon-512.svg","public/icon-512.svg")]:
    if os.path.exists(src):
        shutil.copy(src, dst)
        print(f"✓ {dst}")
    else:
        if "512" in src:
            shutil.copy("icon-192.svg", dst)
            print(f"✓ {dst} (copia de 192)")
        else:
            print(f"WARN: {src} no encontrado")
print("PWA files copiados a public/")
