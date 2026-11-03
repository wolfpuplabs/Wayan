# Wayan New York — Menu 3D + AR

Web menu Wayan (20 Spring St, Nolita) dengan dish 3D yang bisa dilihat di atas meja lewat AR (`<model-viewer>`), plus panel admin untuk upload/ganti model dan edit menu.

- **Tamu:** buka menu → tap dish bertanda **3D** → putar/zoom → **View on your table** (AR, ukuran asli).
  Android: Chrome + ARCore (WebXR / Scene Viewer). iPhone/iPad: Safari (Quick Look, USDZ dibuat otomatis dari GLB).
- **Admin:** buka `/#admin` (atau link **Staff** di footer) → login → upload `.glb`, edit nama/harga/tag/sold out/urutan/section, jam buka, backup.

## Struktur

```
index.html            halaman lengkap (menu, viewer 3D/AR, admin)
models/               6 model contoh (.glb, meshopt) + poster (.webp)
vendor/blob-client.js @vercel/blob/client (bundle, hanya dimuat saat admin upload)
api/                  Vercel Functions
  health.js           status (dipakai halaman untuk pindah ke mode Live)
  login.js / logout.js  sesi admin (token bertanda tangan, berlaku 12 jam)
  menu.js             GET/PUT menu → disimpan di Vercel Blob (20 versi terakhir)
  upload.js           token upload langsung browser → Vercel Blob (maks 30 MB) + hapus file
self-host/server.cjs  alternatif tanpa Vercel (VPS/Node biasa, simpan ke disk)
```

## Deploy di Vercel

1. Import repo ini di Vercel (framework: **Other**, tanpa build command).
2. **Storage → Create → Blob** (public) dan hubungkan ke project → `BLOB_READ_WRITE_TOKEN` terisi otomatis.
3. **Settings → Environment Variables → `ADMIN_PASSWORD`** (minimal 8 karakter, Production).
4. **Redeploy** supaya env var terbaca.

Tanpa Blob store halaman tetap jalan, tapi admin otomatis jatuh ke *mode demo* (tersimpan di browser admin saja).
Mengganti `ADMIN_PASSWORD` otomatis me-logout semua sesi admin.

Menu untuk tamu di-cache CDN maksimal ±60 detik; admin selalu membaca versi terbaru.

## Self-host (opsional)

```bash
npm install
ADMIN_PASSWORD="password-panjang" PORT=3000 npm run selfhost
```
Menyimpan menu di `self-host/data/` dan upload di `self-host/uploads/`. Pasang di belakang HTTPS (AR wajib HTTPS).

## Tips model 3D

- Format **GLB**, satu file, skala **meter** (piring ±0.25 m), origin di dasar piring. Preview admin menampilkan ukuran asli & memberi peringatan kalau skalanya salah.
- Target < 5 MB. Kompres:
  `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 2048`
- Model realistis: scan dish asli pakai Polycam / Luma AI / RealityScan → export GLB.
- Model bawaan di `models/` adalah ilustrasi low-poly (placeholder).

## QR di meja

Link langsung ke dish: `https://<domain>/#dish/<id>` (mis. `#dish/lobster-noodles`). Di desktop, viewer menampilkan QR otomatis.

## Catatan konten

Menu diambil dari menu dinner & brunch di wayan-restaurants.com/new-york. Harga dessert (Pandan Custard 15, Banana Sundae 16) perlu dicek — tidak tercantum di halaman resmi.
