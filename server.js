require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PRIVATE_DIR = path.join(ROOT, "private_uploads");
const GALLERY_DIR = path.join(PRIVATE_DIR, "gallery");
const PREVIEWS_DIR = path.join(PRIVATE_DIR, "previews");
const PROOFS_DIR = path.join(PRIVATE_DIR, "proofs");
for (const dir of [DATA_DIR, PRIVATE_DIR, GALLERY_DIR, PREVIEWS_DIR, PROOFS_DIR]) fs.mkdirSync(dir, { recursive: true });

const DB_FILE = path.join(DATA_DIR, "store.json");
const initial = { orders: [], photos: [] };
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
function db() { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
function save(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
function safeName(name) { return String(name || "").replace(/[^a-zA-Z0-9._-]/g, "_"); }
function escapeHtml(s="") { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
async function createPhotoPreview(photo) {
  const output = path.join(PREVIEWS_DIR, `${safeName(photo.id)}.jpg`);
  await sharp(path.join(GALLERY_DIR, photo.file))
    .rotate()
    .resize({ width: 480, height: 360, fit: "inside", withoutEnlargement: true })
    .blur(2)
    .jpeg({ quality: 55 })
    .toFile(output);
  return output;
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  name: "creator.sid",
  secret: process.env.SESSION_SECRET || "dev-only-change-this-secret",
  resave: false, saveUninitialized: true,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use("/static", express.static(path.join(ROOT, "public")));

const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, PROOFS_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${req.sessionID.slice(0,8)}-${safeName(file.originalname)}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype))
});
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, GALLERY_DIR),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${safeName(file.originalname)}`)
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype))
});

const plans = {
  week: { label: "7 dias", days: 7, cents: 999, price: "R$ 9,99" },
  fortnight: { label: "15 dias", days: 15, cents: 1590, price: "R$ 15,90" },
  month: { label: "30 dias", days: 30, cents: 2990, price: "R$ 29,90" }
};
function adminOnly(req, res, next) { if (!req.session.isAdmin) return res.redirect("/admin"); next(); }
function layout(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#00a9e8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/static/style.css"></head><body>${body}<script src="/static/app.js"></script></body></html>`;
}
function getConfig(name, fallback) { return process.env[name] || fallback; }
function pixField(id, value) {
  const text = String(value);
  const length = Buffer.byteLength(text, "utf8");
  if (length > 99) throw new RangeError(`Pix field ${id} exceeds the 99-byte limit.`);
  return `${id}${String(length).padStart(2, "0")}${text}`;
}
function crc16Ccitt(value) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value, "utf8")) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}
function pixText(value, maxLength) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, maxLength) || "NAO INFORMADO";
}
function createPixPayload({ key, amountCents, txid }) {
  const merchantName = pixText(getConfig("PIX_MERCHANT_NAME", getConfig("CREATOR_NAME", "Liliane Melo")), 25);
  const merchantCity = pixText(getConfig("PIX_MERCHANT_CITY", "SAO PAULO"), 15);
  const merchantAccount = pixField("00", "br.gov.bcb.pix") + pixField("01", key);
  const additionalData = pixField("05", txid);
  const payload = [
    pixField("00", "01"),
    pixField("26", merchantAccount),
    pixField("52", "0000"),
    pixField("53", "986"),
    pixField("54", `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`),
    pixField("58", "BR"),
    pixField("59", merchantName),
    pixField("60", merchantCity),
    pixField("62", additionalData),
    "6304"
  ].join("");
  return `${payload}${crc16Ccitt(payload)}`;
}

app.get("/", (req, res) => {
  const creator = escapeHtml(getConfig("CREATOR_NAME", "Liliane Melo"));
  const handle = escapeHtml(getConfig("CREATOR_HANDLE", "@lilianemelo"));
  const data = db();
  const active = data.orders.some(o => o.sessionId === req.sessionID && o.status === "approved" && new Date(o.expiresAt) > new Date());
  const photos = data.photos.map(p => `<div class="locked-photo">${active ? `<img src="/member/photo/${encodeURIComponent(p.id)}" alt="Conteúdo exclusivo">` : `<img class="blurred-preview" src="/preview/photo/${encodeURIComponent(p.id)}" alt="Prévia desfocada do conteúdo exclusivo"><span class="lock">🔒</span>`}</div>`).join("");
  const body = `
  <header class="topbar"><div class="brand"><span class="brandmark">◉</span> <span>OnlyFans</span></div><span class="safe">🔒 Conteúdo exclusivo</span></header>
  <main class="page">
    <section class="profile">
      <div class="cover"><img src="/static/cover.jpg" alt="Foto de capa" onerror="this.style.display='none'"></div>
      <div class="profile-row"><img class="avatar" src="/static/profile.jpg" alt="Foto de perfil" onerror="this.style.display='none'"><div><h1>${creator} <span class="verified">✓</span></h1><p class="muted">${handle}</p></div></div>
      <p class="bio">Aqui é o meu cantinho… 💙<br>Só para quem sabe apreciar o que é bom.<br>Imagina o que te espera por aqui… 🔥</p>
      <p class="tease">“Não é só sobre fotos, é sobre se sentir especial…” 💋</p>
    </section>
    ${active ? `<div class="notice success">✓ Sua assinatura está ativa. Aproveite o conteúdo exclusivo!</div>` : ""}
    <section class="plans"><h2>♛ Escolha seu plano</h2><p class="muted">Acesso ao conteúdo exclusivo pelo período escolhido.</p><div class="plan-grid">
      ${Object.entries(plans).map(([id,p]) => `<form method="post" action="/checkout" class="plan"><input type="hidden" name="plan" value="${id}"><h3>${p.label}</h3><strong>${p.price}</strong><p>🗓 Acesso por ${p.days} dias</p><button>Assinar agora</button></form>`).join("")}
    </div></section>
    ${req.session.pendingOrder ? `<section class="payment"><h2>Pagamento via Pix</h2><p>Plano selecionado: <b>${escapeHtml(plans[req.session.pendingOrder.plan].label)}</b> — <b>${escapeHtml(plans[req.session.pendingOrder.plan].price)}</b></p><p>Escaneie o QR Code ou copie o código Pix para pagar:</p><div class="pix-qr"><img src="${escapeHtml(req.session.pendingOrder.pixQrCode)}" alt="QR Code Pix para pagamento"><span>Identificador: <code>${escapeHtml(req.session.pendingOrder.txid)}</code></span></div><div class="pix-key"><code id="pixCopyPaste">${escapeHtml(req.session.pendingOrder.pixPayload)}</code><button type="button" class="secondary" data-copy="#pixCopyPaste">Copiar código Pix</button></div><p class="small">O QR Code inclui a chave Pix cadastrada e um identificador exclusivo deste pedido. O pagamento ainda precisa ser conferido manualmente; o envio do comprovante não confirma o crédito automaticamente.</p><form action="/receipt" method="post" enctype="multipart/form-data"><label class="upload-label">Enviar comprovante (JPG, PNG ou WEBP)<input type="file" name="proof" accept="image/jpeg,image/png,image/webp" required></label><button>Enviar comprovante</button></form><p class="small">Seu acesso será liberado depois que o administrador conferir o recebimento real e aprovar o pedido.</p></section>` : ""}
    <section class="gallery"><h2>Um pouquinho do que você vai encontrar…</h2><p class="muted">Prévia do conteúdo exclusivo 💙</p><div class="gallery-grid">${photos || Array.from({length:6},(_,i)=>`<div class="locked-photo"><div class="blurred placeholder p${i%3}"></div><span class="lock">🔒</span></div>`).join("")}</div></section>
  </main><footer>Conteúdo exclusivo • Pagamento conferido manualmente • 💙</footer>`;
  res.send(layout("Perfil da Criadora", body));
});

app.post("/checkout", async (req, res, next) => {
  const plan = plans[req.body.plan];
  if (!plan) return res.status(400).send("Plano inválido.");
  const key = (process.env.PIX_KEY || "").trim();
  if (!key || key === "sua-chave-pix") return res.status(503).send("Configure uma chave Pix registrada no banco antes de iniciar o pagamento.");
  try {
    const txid = crypto.randomBytes(16).toString("hex").toUpperCase().slice(0, 25);
    const pixPayload = createPixPayload({ key, amountCents: plan.cents, txid });
    const pixQrCode = await QRCode.toDataURL(pixPayload, { errorCorrectionLevel: "M", margin: 2, width: 260 });
    req.session.pendingOrder = { plan: req.body.plan, txid, pixPayload, pixQrCode };
    res.redirect("/#pagamento");
  } catch (error) {
    next(error);
  }
});

app.post("/receipt", proofUpload.single("proof"), (req, res) => {
  if (!req.file) return res.status(400).send("Envie um comprovante de imagem válido (JPG, PNG ou WEBP, até 8 MB).");
  if (!req.session.pendingOrder) return res.status(400).send("Escolha um plano antes de enviar o comprovante.");
  const data = db();
  const plan = plans[req.session.pendingOrder.plan];
  const order = {
    id: `P${Date.now().toString(36).toUpperCase()}`,
    sessionId: req.sessionID,
    plan: req.session.pendingOrder.plan,
    txid: req.session.pendingOrder.txid,
    amountCents: plan.cents,
    proofFile: req.file.filename,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: null
  };
  data.orders.unshift(order); save(data);
  req.session.lastOrderId = order.id;
  res.send(layout("Comprovante enviado", `<main class="page narrow"><div class="notice"><h1>Comprovante recebido</h1><p>Seu pedido <b>${escapeHtml(order.id)}</b> está aguardando conferência. As fotos serão liberadas depois que o administrador confirmar o recebimento do Pix.</p><a class="button-link" href="/">Voltar ao perfil</a></div></main>`));
});

app.get("/member/photo/:id", (req, res) => {
  const data = db();
  const active = data.orders.some(o => o.sessionId === req.sessionID && o.status === "approved" && o.expiresAt && new Date(o.expiresAt) > new Date());
  if (!active) return res.status(403).send("Assinatura ativa necessária.");
  const photo = data.photos.find(p => p.id === req.params.id);
  if (!photo) return res.sendStatus(404);
  res.sendFile(path.join(GALLERY_DIR, photo.file));
});

app.get("/preview/photo/:id", async (req, res, next) => {
  try {
    const photo = db().photos.find(p => p.id === req.params.id);
    if (!photo) return res.sendStatus(404);
    const previewPath = path.join(PREVIEWS_DIR, `${safeName(photo.id)}.jpg`);
    try {
      await fs.promises.access(previewPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await createPhotoPreview(photo);
    }
    res.sendFile(previewPath);
  } catch (error) {
    next(error);
  }
});

app.get("/admin", (req, res) => {
  if (req.session.isAdmin) return res.redirect("/admin/dashboard");
  res.send(layout("Administração", `<main class="page narrow"><section class="admin-card"><h1>Área administrativa</h1><p class="muted">Entre para gerenciar comprovantes e fotos.</p><form method="post" action="/admin/login"><label>Senha administrativa<input type="password" name="password" required autocomplete="current-password"></label><button>Entrar</button></form></section></main>`));
});
app.post("/admin/login", (req, res) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || req.body.password !== expected) return res.status(401).send(layout("Acesso negado", `<main class="page narrow"><div class="notice error">Senha incorreta ou ADMIN_PASSWORD não configurada. Configure o arquivo .env e reinicie o servidor.</div><a href="/admin">Tentar novamente</a></main>`));
  req.session.isAdmin = true; res.redirect("/admin/dashboard");
});
app.post("/admin/logout", adminOnly, (req,res) => { req.session.isAdmin = false; res.redirect("/admin"); });
app.get("/admin/dashboard", adminOnly, (req, res) => {
  const data = db();
  const orders = data.orders.map(o => `<article class="order"><div><b>${escapeHtml(o.id)}</b> • ${escapeHtml(plans[o.plan]?.label || o.plan)} • ${escapeHtml(plans[o.plan]?.price || "")}<p class="muted">Enviado: ${new Date(o.createdAt).toLocaleString("pt-BR")} • Status: <b>${escapeHtml(o.status)}</b>${o.txid ? ` • TXID Pix: <code>${escapeHtml(o.txid)}</code>` : ""}</p><a href="/admin/proof/${encodeURIComponent(o.id)}" target="_blank" rel="noopener">Ver comprovante</a></div>${o.status === "pending" ? `<form method="post" action="/admin/approve/${encodeURIComponent(o.id)}"><button>Aprovar pagamento</button></form><form method="post" action="/admin/reject/${encodeURIComponent(o.id)}"><button class="danger">Recusar</button></form>` : ""}</article>`).join("") || "<p>Nenhum pedido ainda.</p>";
  const photos = data.photos.map(p => `<li>${escapeHtml(p.originalName)} <form method="post" action="/admin/delete-photo/${encodeURIComponent(p.id)}"><button class="danger small-btn">Excluir</button></form></li>`).join("");
  res.send(layout("Painel administrativo", `<main class="page admin"><div class="admin-head"><div><h1>Painel administrativo</h1><p class="muted">Pedidos, comprovantes e galeria privada.</p></div><form method="post" action="/admin/logout"><button class="secondary">Sair</button></form></div><section class="admin-card"><h2>Comprovantes e pedidos</h2>${orders}</section><section class="admin-card"><h2>Cadastrar fotos exclusivas</h2><form method="post" action="/admin/upload-photo" enctype="multipart/form-data"><label>Selecionar fotos (JPG, PNG ou WEBP)<input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple required></label><button>Enviar fotos</button></form><p class="small">As imagens ficam em armazenamento privado e só são servidas a assinantes aprovados.</p><ul>${photos}</ul></section></main>`));
});
app.get("/admin/proof/:id", adminOnly, (req, res) => {
  const order = db().orders.find(o => o.id === req.params.id);
  if (!order) return res.sendStatus(404);
  res.sendFile(path.join(PROOFS_DIR, order.proofFile));
});
app.post("/admin/approve/:id", adminOnly, (req, res) => {
  const data = db(); const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.sendStatus(404);
  order.status = "approved"; order.approvedAt = new Date().toISOString();
  order.expiresAt = new Date(Date.now() + plans[order.plan].days * 86400000).toISOString();
  save(data); res.redirect("/admin/dashboard");
});
app.post("/admin/reject/:id", adminOnly, (req, res) => {
  const data = db(); const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.sendStatus(404);
  order.status = "rejected"; save(data); res.redirect("/admin/dashboard");
});
app.post("/admin/upload-photo", adminOnly, photoUpload.array("photos", 30), async (req, res, next) => {
  try {
    const data = db();
    for (const file of (req.files || [])) {
      const photo = { id: `IMG${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`, file: file.filename, originalName: file.originalname, createdAt: new Date().toISOString() };
      await createPhotoPreview(photo);
      data.photos.push(photo);
    }
    save(data);
    res.redirect("/admin/dashboard");
  } catch (error) {
    next(error);
  }
});
app.post("/admin/delete-photo/:id", adminOnly, (req, res) => {
  const data = db(); const idx = data.photos.findIndex(p => p.id === req.params.id);
  if (idx >= 0) {
    const photo = data.photos.splice(idx,1)[0];
    fs.rmSync(path.join(GALLERY_DIR, photo.file), { force: true });
    fs.rmSync(path.join(PREVIEWS_DIR, `${safeName(photo.id)}.jpg`), { force: true });
    save(data);
  }
  res.redirect("/admin/dashboard");
});

app.get("/health", (_, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Site rodando em http://localhost:${PORT}`));
