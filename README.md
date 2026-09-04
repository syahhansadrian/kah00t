# 🎮 QuizLive (Kahoot Clone)

Platform kuis interaktif real-time minimalis — tanpa batas pemain di plan gratis.
Pemain join via PIN, jawab soal, raih skor berbasis kecepatan, dan masuk podium!

## Teknologi
- **Backend:** Node.js + Express + Socket.IO (WebSocket real-time)
- **Frontend:** HTML/CSS/JS murni (tanpa framework)
- **Storage:** In-memory (perlu server persistent, bukan di memori serverless)

---

## 🚀 Menjalankan Lokal

```bash
npm install
npm start
```

Buka:
- **Admin (host):** http://localhost:3000/admin
- **Pemain (join):** http://localhost:3000/play
- **Beranda:** http://localhost:3000

---

## ☁️ Deploy Gratis

> ⚠️ **JANGAN pakai Vercel / Netlify** — mereka serverless.
> App ini butuh **proses server berjalan terus** untuk WebSocket.
> Pilih salah satu di bawah ini.

### Opsi 1: Render.com (Paling Mudah, Gratis) ⭐

Render punya web service gratis yang **mendukung WebSocket**.

1. Push project ini ke **GitHub** (repo privat).
2. Buka https://render.com → **Sign up** (Google/GitHub).
3. Klik **New +** → **Web Service** → Connect repo kamu.
4. Isi konfigurasi:
   - **Name:** `quizlive`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** pilih **Free**
5. Klik **Create Web Service**.
6. Tunggu 1-3 menit build. Lalu dapat URL seperti:
   `https://quizlive.onrender.com`
7. Semua orang bisa pakai via URL itu. 🎉

**Catatan Free Plan:**
- Server **tidur setelah 15 menit tanpa request** — membuka halaman akan hidupkan lagi (cold start ~50 detik pertama).
- Arrow kecil ke bawah punya **ungu/panah**? Tidak — cukup untuk demo/kelas. Kalau sudah dipakai rutin, upgrade ke Starter ($7/bln) biar selalu hidup.

---

### Opsi 2: Oracle Cloud Always Free (Terbaik untuk 24/7) 🏆

Oracle kasih **VM gratis selamanya** (2x AMD + 4 CPU, 24GB RAM). Cocok kalau mau server selalu-on tanpa hibernasi.

1. Daftar di https://www.oracle.com/cloud/free/ (butuh kartu kredit untuk verifikasi, TIDAK ditagih).
2. Buat **VM instance** — pilih OS **Ubuntu 22.04**.
3. Buka SSH ke VM, lalu jalankan:

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Clone project
git clone https://github.com/USERNAME/quizlive.git
cd quizlive
npm install

# Install PM2 (process manager agar selalu hidup)
sudo npm install -g pm2
pm2 start server.js --name quizlive
pm2 save
pm2 startup   # ikuti perintah yang muncul
```

4. Set **Security List** (Network) → buka port **80** (ingress, 0.0.0.0/0 TCP).
5. Forward ke app: `sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000`
6. Akses lewat IP publik VM: `http://IP_VM`

**Selalu hidup 24/7** — tidak ada hibernasi, tanpa biaya.

---

## 📦 Struktur Project

```
├── server.js          ← Server (Express + Socket.IO + game logic)
├── package.json
├── .gitignore
└── public/
    ├── index.html     ← Landing (Join / Buat kuis)
    ├── play.html      ← Halaman pemain (PIN → game → podium)
    ├── admin.html     ← Halaman admin/host (buat kuis + kontrol game)
    ├── host.html      ← (cadangan) layar host
    ├── game.html      ← (cadangan) layar pemain
    └── css/style.css
```

---

## 🧠 Catatan Teknis

- **In-memory:** Data (kuis, player, game) disimpan di RAM server. Restart server = data hilang. Cocok untuk sesi live. Kalau mau persist, upgrade ke database (Postgres/Redis) — hubungi saja.
- **Skalabilitas:** 1 instance cukup untuk ratusan pemain. Untuk ribuan + multi-instance, perlu skalabilitas tambahan (Redis pub/sub). Untuk kelas/sekolah — sudah lebih dari cukup.

## 📄 Lisensi
Bebas dipakai & dimodifikasi untuk pembelajaran.