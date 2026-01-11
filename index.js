// index.js - Maleficis Plantaciones + Chester + Tienda + Tramportista (Railway ready)
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// =====================
// CONFIG
// =====================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Plantaciones
const DUPLICAR_MS = 3 * 60 * 60 * 1000;        // 3h
const REGAR_MS    = (2 * 60 + 30) * 60 * 1000; // 2h 30m
const COSECHAR_MS = 3 * 60 * 60 * 1000;        // 3h
const MAX_COSECHAS = 3;

// Chester
const CHESTER_JOBS = [
  "molotov",
  "parking",
  "ventanillas",
  "ruedas",
  "grafitis",
  "peleas",
  "moto",        // ✅ antes "transporte"
  "coche",
];
const CHESTER_CD_MS = 24 * 60 * 60 * 1000; // 24h

// Tienda
const TIENDA_CD_SOLO_MS = 5 * 60 * 60 * 1000;  // 5h
const TIENDA_CD_GRUPO_MS = 2 * 60 * 60 * 1000; // 2h

// Reinicios ARG: 00:00 / 08:00 / 16:00
const RESET_HOURS = [0, 8, 16]; // usar TZ=America/Argentina/Buenos_Aires en Railway

// Tramportista
const TRAMPORTISTA_IMAGE =
  "https://static.wikia.nocookie.net/esgta/images/2/2f/YankeeviejoGTAV.jpg/revision/latest?cb=20141205120106";

// Rol a pinguear por nombre (exacto)
const PING_ROLE_NAME = "marihuana";

// =====================
// SIMPLE FILE DB
// =====================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJSON(file, fallback) {
  const p = path.join(DATA_DIR, file);
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function saveJSON(file, data) {
  const p = path.join(DATA_DIR, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

const DB = {
  plantaciones: loadJSON("plantaciones.json", []),
  chester: loadJSON("chester.json", {}), // { userId: { job: nextTs, job_notifiedTs: nextTs } }
  chesterPanels: loadJSON("chester_panels.json", {}), // { userId: { channelId, messageId } }
  tienda: loadJSON("tienda.json", {}),
  tramportista: loadJSON("tramportista.json", { resetKey: null, done: {} }),
  registro: loadJSON("registro.json", []),
};

function logReg(entry) {
  DB.registro.push(entry);
  saveJSON("registro.json", DB.registro);
}

function now() { return Date.now(); }
function toUnix(ms) { return Math.floor(ms / 1000); }
function relTs(ms) { return `<t:${toUnix(ms)}:R>`; }
function absTs(ms) { return `<t:${toUnix(ms)}:f>`; }

function fmtTipo(tipo) {
  return tipo === "duplicar" ? "Duplicar" : "Cosecha";
}

function capFirst(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function niceJob(job) {
  if (job === "moto") return "Moto";
  return capFirst(job);
}

function nextPlantId() {
  const max = DB.plantaciones.reduce((m, p) => Math.max(m, p.id), 0);
  return max + 1;
}

function getPlantByNumber(n) {
  const list = [...DB.plantaciones].sort((a, b) => a.id - b.id);
  return list[n - 1] || null;
}

function removePlant(id) {
  DB.plantaciones = DB.plantaciones.filter(p => p.id !== id);
  saveJSON("plantaciones.json", DB.plantaciones);
}

function updatePlant(patch) {
  const idx = DB.plantaciones.findIndex(p => p.id === patch.id);
  if (idx >= 0) {
    DB.plantaciones[idx] = { ...DB.plantaciones[idx], ...patch };
    saveJSON("plantaciones.json", DB.plantaciones);
  }
}

async function safeFetchChannel(client, channelId) {
  try { return await client.channels.fetch(channelId); } catch { return null; }
}
async function safeFetchMessage(channel, messageId) {
  try { return await channel.messages.fetch(messageId); } catch { return null; }
}

// =====================
// DISCORD CLIENT
// =====================
// ✅ Sin GuildMembers para evitar "Used disallowed intents" si no lo tenés habilitado.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

// =====================
// ROLE PING (por ID real)
// =====================
async function getRoleMentionForGuild(guild) {
  if (!guild) return { content: `@${PING_ROLE_NAME}`, allowedMentions: { parse: [] } };

  try {
    if (!guild.roles.cache?.size) {
      await guild.roles.fetch().catch(() => {});
    }

    const role = guild.roles.cache.find(
      r => (r.name || "").toLowerCase() === PING_ROLE_NAME.toLowerCase()
    );

    if (!role) {
      return { content: `@${PING_ROLE_NAME}`, allowedMentions: { parse: [] } };
    }

    return {
      content: `<@&${role.id}>`,
      allowedMentions: { roles: [role.id], users: [], repliedUser: false },
    };
  } catch {
    return { content: `@${PING_ROLE_NAME}`, allowedMentions: { parse: [] } };
  }
}

// =====================
// SLASH COMMANDS
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("plantacion")
    .setDescription("Crear una plantación (cosecha o duplicar semillas)")
    .addStringOption(opt =>
      opt.setName("tipo")
        .setDescription("Tipo de plantación")
        .setRequired(true)
        .addChoices(
          { name: "Cosecha", value: "cosecha" },
          { name: "Duplicar semillas", value: "duplicar" },
        )
    )
    .addStringOption(opt =>
      opt.setName("descripcion")
        .setDescription("Descripción (opcional)")
        .setRequired(false)
    )
    .addAttachmentOption(opt =>
      opt.setName("foto")
        .setDescription("Foto (opcional)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("plantaciones")
    .setDescription("Ver plantaciones activas y tiempos"),

  new SlashCommandBuilder()
    .setName("borrarplantacion")
    .setDescription("Borrar plantación por número (#1, #2...)")
    .addIntegerOption(opt =>
      opt.setName("numero")
        .setDescription("Número de la lista")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("chester")
    .setDescription("🧰 Chester: panel de trabajos (CD 24h por trabajo) (público)"),

  new SlashCommandBuilder()
    .setName("tienda")
    .setDescription("🏪 Iniciar cooldown de robo a tienda (solo/grupo)")
    .addStringOption(opt =>
      opt.setName("modo")
        .setDescription("Modo")
        .setRequired(true)
        .addChoices(
          { name: "Solo (5h)", value: "solo" },
          { name: "Grupo (2h)", value: "grupo" },
        )
    )
    .addStringOption(opt =>
      opt.setName("nombre")
        .setDescription("Nombre/tienda")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("tramportista")
    .setDescription("🚚 Marca que hiciste el Tramportista (1 vez por reinicio 00/08/16)"),

  new SlashCommandBuilder()
    .setName("registro")
    .setDescription("Ver registro completo (ADMIN)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt =>
      opt.setName("usuario")
        .setDescription("Filtrar por usuario")
        .setRequired(false)
    ),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log("✅ Comandos registrados:", commands.map(c => c.name).join(", "));
}

// =====================
// EMBEDS
// =====================
function plantCompletedEmbed(p) {
  const created = p.createdAt ?? now();
  const plantedBy = p.createdBy ? `<@${p.createdBy}>` : "—";

  const waterCount = p.waterCount || 0;
  const harvestCount = p.harvestCount || 0;

  const e = new EmbedBuilder()
    .setTitle(`✅ Plantación completada • #${p.id}`)
    .setColor(0x2ecc71)
    .setFooter({ text: "Maleficis • Plantaciones" })
    .setTimestamp(new Date(created));

  const desc = (p.descripcion && p.descripcion.trim().length > 0)
    ? p.descripcion.trim()
    : "Sin descripción.";

  let lines = [];
  lines.push(`📌 **${fmtTipo(p.tipo)}** — ${desc}`);
  lines.push(`🌱 **Plantó:** ${plantedBy}`);

  // si no regó y no cosechó nadie, no lo muestres
  if (waterCount > 0 || harvestCount > 0) {
    lines.push(`💧 **Regó:** ${waterCount} • 🧺 **Cosechó:** ${harvestCount}`);
  }

  e.setDescription(lines.join("\n"));

  // si es duplicar, NO mostrar foto al terminar
  if (p.tipo !== "duplicar" && p.imageUrl) {
    e.setImage(p.imageUrl);
  }

  return e;
}

function plantEmbed(p) {
  if (p.completed) return plantCompletedEmbed(p);

  const created = p.createdAt ?? now();
  const e = new EmbedBuilder()
    .setTitle(`🌿 Plantación #${p.id}`)
    .setColor(p.tipo === "duplicar" ? 0x2ecc71 : 0x3498db)
    .setFooter({ text: "Maleficis • Plantaciones" })
    .setTimestamp(new Date(created));

  const desc = (p.descripcion && p.descripcion.trim().length > 0)
    ? p.descripcion.trim()
    : "Sin descripción.";

  e.addFields(
    { name: "📝 Descripción", value: desc, inline: false },
    { name: "📌 Tipo", value: fmtTipo(p.tipo), inline: true },
    { name: "👤 Plantó", value: `<@${p.createdBy}>`, inline: true },
    { name: "📅 Creada", value: absTs(created), inline: false },
  );

  if (p.tipo === "duplicar") {
    const readyAt = p.readyAt;
    const isReady = now() >= readyAt;
    e.addFields(
      { name: "📍 Estado", value: isReady ? "✅ Lista para cultivar" : "🌱 Creciendo", inline: true },
      { name: "🌿 Cultivar", value: isReady ? "Ahora" : relTs(readyAt), inline: true },
    );
  } else {
    const regarAt = p.nextWaterAt;
    const cosecharAt = p.nextHarvestAt;
    e.addFields(
      { name: "📍 Progreso", value: `Cosechas: **${p.harvestCount}/${MAX_COSECHAS}** • Riegos: **${p.waterCount || 0}**`, inline: false },
      { name: "💧 Próximo riego", value: relTs(regarAt), inline: true },
      { name: "🧺 Próxima cosecha", value: relTs(cosecharAt), inline: true },
    );
  }

  if (p.imageUrl) e.setImage(p.imageUrl);
  return e;
}

function chesterEmbed(userId) {
  const e = new EmbedBuilder()
    .setTitle("🧰 Chester • Trabajos")
    .setDescription(
      `👤 **Panel de:** <@${userId}>\n` +
      `✅ Marcá lo que hiciste y te aviso cuando vuelva.\n` +
      `🔒 **Solo el dueño** puede apretar los botones.`
    )
    .setColor(0x9b59b6)
    .setFooter({ text: "Maleficis • Chester" });

  const lines = CHESTER_JOBS.map(job => {
    const nextTs = DB.chester?.[userId]?.[job] || 0;
    const available = now() >= nextTs;
    const nice = niceJob(job);
    return available
      ? `✅ **${nice}** — Disponible`
      : `⏳ **${nice}** — ${relTs(nextTs)}`;
  });

  e.addFields({ name: "📋 Estado", value: lines.join("\n"), inline: false });
  return e;
}

function tiendaEmbed(userId, modo, nombre, nextTs) {
  const e = new EmbedBuilder()
    .setTitle("🏪 Robo a tienda • Cooldown")
    .setColor(0xe67e22)
    .setFooter({ text: "Maleficis • Tiendas" });

  e.addFields(
    { name: "👤 Usuario", value: `<@${userId}>`, inline: true },
    { name: "👥 Modo", value: modo === "grupo" ? "Grupo (2h)" : "Solo (5h)", inline: true },
    { name: "📍 Tienda", value: nombre, inline: false },
    { name: "✅ Disponible", value: relTs(nextTs), inline: true },
  );

  return e;
}

function tramportistaEmbed(userId, resetKey) {
  return new EmbedBuilder()
    .setTitle("🚚 Tramportista • Registrado")
    .setDescription(
      `👤 **Hecho por:** <@${userId}>\n` +
      `🕒 **Reinicio actual:** \`${resetKey}\`\n` +
      `✅ **Estado:** Registrado`
    )
    .setColor(0x1abc9c)
    .setFooter({ text: "Maleficis • Tramportista" })
    .setImage(TRAMPORTISTA_IMAGE)
    .setTimestamp(new Date(now()));
}

// =====================
// BUTTONS
// =====================
function chesterButtons(userId) {
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let countInRow = 0;

  for (const job of CHESTER_JOBS) {
    const nextTs = DB.chester?.[userId]?.[job] || 0;
    const available = now() >= nextTs;

    const nice = niceJob(job);
    const label = available ? `✅ ${nice}` : `⏳ ${nice}`;

    const btn = new ButtonBuilder()
      .setCustomId(`chester_${job}_${userId}`)
      .setLabel(label.slice(0, 80))
      .setStyle(available ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!available);

    currentRow.addComponents(btn);
    countInRow++;

    if (countInRow === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      countInRow = 0;
    }
  }
  if (countInRow > 0) rows.push(currentRow);
  return rows;
}

// =====================
// ALERT MESSAGE CLEANUP
// =====================
async function cleanupAlertMessage(msg) {
  if (!msg) return;
  try {
    await msg.delete();
    return;
  } catch {
    try {
      await msg.edit({ content: "✅ Listo.", embeds: [], components: [] });
    } catch {}
  }
}

// =====================
// PLANT MAIN MESSAGE (NO DUPLICADOS)
// =====================
async function ensurePlantMessage(p) {
  const ch = await safeFetchChannel(client, p.channelId);
  if (!ch) return;

  if (p.messageId) {
    const msg = await safeFetchMessage(ch, p.messageId);
    if (!msg) return; // evita duplicados si no se puede fetchear

    const embed = plantEmbed(p);
    await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    return;
  }

  const embed = plantEmbed(p);
  const sent = await ch.send({ embeds: [embed] }).catch(() => null);
  if (sent) updatePlant({ id: p.id, messageId: sent.id });
}

// =====================
// CHESTER PANEL UPDATE (AUTO)
// =====================
async function refreshChesterPanel(userId) {
  const panel = DB.chesterPanels?.[userId];
  if (!panel?.channelId || !panel?.messageId) return;

  const ch = await safeFetchChannel(client, panel.channelId);
  if (!ch) return;

  const msg = await safeFetchMessage(ch, panel.messageId);
  if (!msg) return;

  await msg.edit({
    embeds: [chesterEmbed(userId)],
    components: chesterButtons(userId),
  }).catch(() => {});
}

// =====================
// ALERT SENDER
// =====================
async function sendPlantAlert(p, kind) {
  const ch = await safeFetchChannel(client, p.channelId);
  if (!ch) return;

  const embed = plantEmbed(p);
  const rows = [];

  if (p.tipo === "duplicar") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`plant_cultivar_${p.id}`)
          .setLabel("🌿 Cultivar")
          .setStyle(ButtonStyle.Success)
      )
    );
  } else {
    const row = new ActionRowBuilder();
    if (kind === "regar") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`plant_regar_${p.id}`)
          .setLabel("💧 Regar")
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (kind === "cosechar") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`plant_cosechar_${p.id}`)
          .setLabel("🧺 Cosechar")
          .setStyle(ButtonStyle.Success)
      );
    }
    rows.push(row);
  }

  const pingInfo = await getRoleMentionForGuild(ch.guild);
  const baseTitle =
    p.tipo === "duplicar"
      ? `🌿 Plantación #${p.id} lista para **cultivar**`
      : (kind === "regar"
        ? `💧 Plantación #${p.id} necesita **riego**`
        : `🧺 Plantación #${p.id} lista para **cosechar**`);

  await ch.send({
    content: `${pingInfo.content} ${baseTitle}`,
    allowedMentions: pingInfo.allowedMentions,
    embeds: [embed],
    components: rows
  }).catch(() => {});
}

// =====================
// UTILS
// =====================
function isNotifiedKey(k) {
  return typeof k === "string" && (k.endsWith("_notified") || k.endsWith("_notifiedTs"));
}

// =====================
// TRAMPORTISTA WINDOWS
// =====================
function makeKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}|${hh}`;
}

function getCurrentResetWindowKey() {
  const d = new Date();
  const h = d.getHours();

  const sorted = [...RESET_HOURS].sort((a, b) => a - b);
  let chosenHour = null;

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i] <= h) { chosenHour = sorted[i]; break; }
  }

  const base = new Date(d);
  base.setMinutes(0, 0, 0);

  if (chosenHour === null) {
    base.setDate(base.getDate() - 1);
    chosenHour = sorted[sorted.length - 1];
  }

  base.setHours(chosenHour, 0, 0, 0);
  return makeKey(base);
}

function ensureTramportistaWindow() {
  const currentKey = getCurrentResetWindowKey();
  if (DB.tramportista.resetKey !== currentKey) {
    DB.tramportista.resetKey = currentKey;
    DB.tramportista.done = {};
    saveJSON("tramportista.json", DB.tramportista);
  }
  return currentKey;
}

// =====================
// MAIN LOOP
// =====================
setInterval(async () => {
  // Plantaciones
  for (const p of DB.plantaciones) {
    try {
      if (p.completed) continue;

      if (p.tipo === "duplicar") {
        if (!p.alertedReady && now() >= p.readyAt) {
          updatePlant({ id: p.id, alertedReady: true });
          await sendPlantAlert({ ...p, alertedReady: true }, "cultivar");
        }
      } else {
        if (!p.alertedWater && now() >= p.nextWaterAt) {
          updatePlant({ id: p.id, alertedWater: true });
          await sendPlantAlert({ ...p, alertedWater: true }, "regar");
        }
        if (!p.alertedHarvest && now() >= p.nextHarvestAt) {
          updatePlant({ id: p.id, alertedHarvest: true });
          await sendPlantAlert({ ...p, alertedHarvest: true }, "cosechar");
        }
      }
    } catch {}
  }

  // Chester reminders + ✅ refrescar panel para reactivar botones/estado
  for (const userId of Object.keys(DB.chester)) {
    for (const job of Object.keys(DB.chester[userId] || {})) {
      if (isNotifiedKey(job)) continue;

      const ts = DB.chester[userId][job];
      if (!ts || typeof ts !== "number") continue;

      // ✅ antispam real: solo notificar 1 vez por cada "ts"
      const notifiedKey = `${job}_notifiedTs`;
      const alreadyNotifiedTs = DB.chester[userId][notifiedKey] || 0;

      if (now() >= ts && alreadyNotifiedTs !== ts) {
        // guardar primero (anti duplicado incluso si crashea)
        DB.chester[userId][notifiedKey] = ts;
        saveJSON("chester.json", DB.chester);

        // refrescar panel para que pase a "Disponible" y habilite el botón
        await refreshChesterPanel(userId);

        // DM (si se puede)
        try {
          const user = await client.users.fetch(userId);
          await user.send(`✅ Ya puedes hacer el trabajo de **${niceJob(job)}**.`);
        } catch {}
      }
    }
  }

  // Tienda reminders (sin duplicados por keys *_notified)
  for (const userId of Object.keys(DB.tienda)) {
    for (const key of Object.keys(DB.tienda[userId] || {})) {
      if (key.endsWith("_notified")) continue;

      const ts = DB.tienda[userId][key];
      if (!ts || typeof ts !== "number") continue;

      if (!DB.tienda[userId][`${key}_notified`] && now() >= ts) {
        DB.tienda[userId][`${key}_notified`] = true;
        saveJSON("tienda.json", DB.tienda);

        const [modoRaw, nombreRaw] = key.split("|");
        const modo = (modoRaw || "solo").toLowerCase();
        const nombre = (nombreRaw || "tienda").trim();

        try {
          const user = await client.users.fetch(userId);
          await user.send(`🏪 Ya puedes volver a hacer **robo a tienda** (${modo}) en **${nombre}**.`);
        } catch {}
      }
    }
  }
}, 20 * 1000);

// Reset horario 00/08/16
setInterval(() => {
  const d = new Date();
  const hour = d.getHours();
  const min = d.getMinutes();

  if (min !== 0) return;
  if (!RESET_HOURS.includes(hour)) return;

  // Reset Tienda
  DB.tienda = {};
  saveJSON("tienda.json", DB.tienda);

  // Reset Tramportista
  DB.tramportista.resetKey = makeKey(new Date(d.setMinutes(0, 0, 0)));
  DB.tramportista.done = {};
  saveJSON("tramportista.json", DB.tramportista);

  logReg({ type: "reset_horario", at: now(), by: "system", meta: { hour, resetKey: DB.tramportista.resetKey } });
  console.log(`🟧 Reset horario aplicado (${hour}:00). Tienda y Tramportista reseteados.`);
}, 60 * 1000);

// =====================
// REGISTRO nombres humanos
// =====================
async function resolveUserLabel(userId) {
  if (!userId || userId === "system") return "Sistema";
  try {
    const u = await client.users.fetch(userId);
    const name = u.globalName || u.username || "Usuario";
    return `${name} (<@${userId}>)`;
  } catch {
    return `Desconocido (<@${userId}>)`;
  }
}

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {
  try {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === "plantacion") {
        const tipo = interaction.options.getString("tipo", true);
        const descripcion = interaction.options.getString("descripcion") || "";
        const foto = interaction.options.getAttachment("foto");

        const p = {
          id: nextPlantId(),
          tipo,
          descripcion,
          imageUrl: foto?.url || null,
          createdAt: now(),
          createdBy: interaction.user.id,
          channelId: interaction.channelId,
          messageId: null,

          harvestCount: 0,
          waterCount: 0,
          readyAt: null,
          nextWaterAt: null,
          nextHarvestAt: null,

          alertedReady: false,
          alertedWater: false,
          alertedHarvest: false,

          completed: false,
          completedAt: null,
        };

        if (tipo === "duplicar") {
          p.readyAt = p.createdAt + DUPLICAR_MS;
        } else {
          p.nextWaterAt = p.createdAt + REGAR_MS;
          p.nextHarvestAt = p.createdAt + COSECHAR_MS;
        }

        DB.plantaciones.push(p);
        saveJSON("plantaciones.json", DB.plantaciones);

        await interaction.reply({
          ephemeral: true,
          content: `✅ Plantación creada como **${fmtTipo(tipo)}** (#${p.id}).`,
        });

        await ensurePlantMessage(p);

        logReg({
          type: "plantacion_creada",
          at: now(),
          by: interaction.user.id,
          meta: { plantId: p.id, tipo, descripcion: descripcion || null },
        });

        return;
      }

      if (name === "plantaciones") {
        const list = [...DB.plantaciones].sort((a, b) => a.id - b.id);
        if (list.length === 0) {
          return interaction.reply({ ephemeral: true, content: "No hay plantaciones activas." });
        }

        const lines = list.map((p, i) => {
          const num = i + 1;
          const estado = p.completed ? "✅ COMPLETADA" : "🟦 Activa";

          if (p.tipo === "duplicar") {
            const ready = p.completed ? "—" : (now() >= p.readyAt ? "✅ lista" : relTs(p.readyAt));
            return `**#${num}** → 🌿 **#${p.id}** • **${fmtTipo(p.tipo)}** • ${estado} • Cultivar: ${ready}`;
          } else {
            return `**#${num}** → 🌱 **#${p.id}** • **${fmtTipo(p.tipo)}** • ${estado} • 💧 ${p.completed ? "—" : relTs(p.nextWaterAt)} • 🧺 ${p.completed ? "—" : relTs(p.nextHarvestAt)} • (Riegos ${p.waterCount || 0} / Cosechas ${p.harvestCount}/${MAX_COSECHAS})`;
          }
        });

        const e = new EmbedBuilder()
          .setTitle("🌿 Plantaciones")
          .setColor(0x95a5a6)
          .setDescription(lines.join("\n"));

        return interaction.reply({ ephemeral: true, embeds: [e] });
      }

      if (name === "borrarplantacion") {
        const numero = interaction.options.getInteger("numero", true);
        const p = getPlantByNumber(numero);
        if (!p) return interaction.reply({ ephemeral: true, content: "No existe esa plantación en la lista." });

        const ch = await safeFetchChannel(client, p.channelId);
        if (ch && p.messageId) {
          const msg = await safeFetchMessage(ch, p.messageId);
          if (msg) await cleanupAlertMessage(msg);
        }

        removePlant(p.id);

        logReg({ type: "plantacion_borrada", at: now(), by: interaction.user.id, meta: { plantId: p.id } });
        return interaction.reply({ ephemeral: true, content: `🗑️ Plantación #${p.id} eliminada.` });
      }

      if (name === "chester") {
        const userId = interaction.user.id;
        if (!DB.chester[userId]) DB.chester[userId] = {};
        saveJSON("chester.json", DB.chester);

        const e = chesterEmbed(userId);
        const rows = chesterButtons(userId);

        // ✅ público
        const sent = await interaction.reply({ ephemeral: false, embeds: [e], components: rows, fetchReply: true });

        // ✅ guardar panel para refrescarlo automático
        if (sent?.id) {
          DB.chesterPanels[userId] = { channelId: interaction.channelId, messageId: sent.id };
          saveJSON("chester_panels.json", DB.chesterPanels);
        }

        return;
      }

      if (name === "tienda") {
        const modo = interaction.options.getString("modo", true);
        const nombre = interaction.options.getString("nombre", true).trim();

        const cd = modo === "grupo" ? TIENDA_CD_GRUPO_MS : TIENDA_CD_SOLO_MS;
        const key = `${modo}|${nombre.toLowerCase()}`;

        if (!DB.tienda[interaction.user.id]) DB.tienda[interaction.user.id] = {};
        DB.tienda[interaction.user.id][key] = now() + cd;
        DB.tienda[interaction.user.id][`${key}_notified`] = false;
        saveJSON("tienda.json", DB.tienda);

        logReg({ type: "tienda_inicio", at: now(), by: interaction.user.id, meta: { modo, nombre } });

        const e = tiendaEmbed(interaction.user.id, modo, nombre, now() + cd);

        return interaction.reply({
          ephemeral: true,
          embeds: [e],
          content: "✅ Cooldown iniciado. Te avisaré por DM cuando puedas volver a hacerlo.",
        });
      }

      if (name === "tramportista") {
        const resetKey = ensureTramportistaWindow();
        const userId = interaction.user.id;

        if (!DB.tramportista.done) DB.tramportista.done = {};
        if (DB.tramportista.done[userId]) {
          return interaction.reply({ ephemeral: true, content: `⚠️ Ya lo registraste en este reinicio (**${resetKey}**).` });
        }

        DB.tramportista.done[userId] = true;
        saveJSON("tramportista.json", DB.tramportista);

        logReg({ type: "tramportista_hecho", at: now(), by: userId, meta: { resetKey } });

        return interaction.reply({
          ephemeral: false,
          embeds: [tramportistaEmbed(userId, resetKey)],
          content: `🚚 **Tramportista registrado** por <@${userId}>.`,
        });
      }

      if (name === "registro") {
        const usuario = interaction.options.getUser("usuario");

        const entries = DB.registro.slice();
        const filtered = usuario
          ? entries.filter(e => e.by === usuario.id || e.meta?.userId === usuario.id)
          : entries;

        if (filtered.length === 0) {
          return interaction.reply({ ephemeral: true, content: "No hay registros para mostrar." });
        }

        const byUser = {};
        for (const e of filtered) {
          const u = e.by || "system";
          if (!byUser[u]) byUser[u] = [];
          byUser[u].push(e);
        }

        const userIds = Object.keys(byUser).slice(0, 10);
        const labels = {};
        for (const uid of userIds) labels[uid] = await resolveUserLabel(uid);

        const blocks = Object.entries(byUser).map(([u, arr]) => {
          const who = labels[u] || (u === "system" ? "Sistema" : `(<@${u}>)`);
          const lines = arr
            .sort((a, b) => a.at - b.at)
            .slice(-25)
            .map(ev => {
              const when = absTs(ev.at);
              const t = ev.type;
              let detail = "";
              if (t.startsWith("plantacion")) detail = ev.meta?.plantId ? `(#${ev.meta.plantId})` : "";
              if (t.startsWith("chester")) detail = ev.meta?.job ? `(${niceJob(ev.meta.job)})` : "";
              if (t.startsWith("tienda")) detail = ev.meta?.nombre ? `(${ev.meta.modo} • ${ev.meta.nombre})` : "";
              if (t.startsWith("tramportista")) detail = ev.meta?.resetKey ? `(${ev.meta.resetKey})` : "";
              return `• ${when} — **${t}** ${detail}`.trim();
            });

          return { who, lines };
        });

        const e = new EmbedBuilder()
          .setTitle(usuario ? `📚 Registro • ${usuario.globalName || usuario.username}` : "📚 Registro • General")
          .setColor(0x34495e)
          .setDescription("Resumen por usuario (últimos eventos por usuario).");

        for (const b of blocks.slice(0, 8)) {
          e.addFields({ name: b.who.slice(0, 256), value: (b.lines.join("\n") || "—").slice(0, 1024), inline: false });
        }

        return interaction.reply({ ephemeral: true, embeds: [e] });
      }
    }

    // =====================
    // BUTTONS
    // =====================
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Plantaciones
      if (id.startsWith("plant_")) {
        const parts = id.split("_");
        const action = parts[1];
        const plantId = parseInt(parts[2], 10);

        const p = DB.plantaciones.find(x => x.id === plantId);
        if (!p) {
          await interaction.reply({ ephemeral: true, content: "Esa plantación ya no existe." });
          await cleanupAlertMessage(interaction.message);
          return;
        }

        if (p.tipo === "duplicar" && action === "cultivar") {
          if (p.completed) {
            await interaction.reply({ ephemeral: true, content: "✅ Esa plantación ya está completada." });
            await cleanupAlertMessage(interaction.message);
            return;
          }
          if (now() < p.readyAt) {
            await interaction.reply({ ephemeral: true, content: `Aún no está lista. Cultivar ${relTs(p.readyAt)}.` });
            return;
          }

          updatePlant({ id: p.id, completed: true, completedAt: now(), alertedReady: true });

          logReg({ type: "plantacion_completada", at: now(), by: interaction.user.id, meta: { plantId: p.id, tipo: p.tipo } });

          const updated = DB.plantaciones.find(x => x.id === p.id);
          await ensurePlantMessage(updated);
          await cleanupAlertMessage(interaction.message);

          return interaction.reply({ ephemeral: false, content: `✅ Plantación #${p.id} completada por <@${interaction.user.id}>.` });
        }

        if (p.tipo === "cosecha") {
          if (p.completed) {
            await interaction.reply({ ephemeral: true, content: "✅ Esa plantación ya está completada." });
            await cleanupAlertMessage(interaction.message);
            return;
          }

          if (action === "regar") {
            if (now() < p.nextWaterAt) {
              return interaction.reply({ ephemeral: true, content: `Aún no toca. Próximo riego ${relTs(p.nextWaterAt)}.` });
            }

            const newWaterAt = now() + REGAR_MS;
            const newWaterCount = (p.waterCount || 0) + 1;

            updatePlant({ id: p.id, waterCount: newWaterCount, nextWaterAt: newWaterAt, alertedWater: false });

            logReg({ type: "plantacion_regada", at: now(), by: interaction.user.id, meta: { plantId: p.id } });

            const updated = DB.plantaciones.find(x => x.id === p.id);
            await ensurePlantMessage(updated);
            await cleanupAlertMessage(interaction.message);

            return interaction.reply({ ephemeral: false, content: `💧 Plantación #${p.id} regada por <@${interaction.user.id}>. Próximo riego ${relTs(newWaterAt)}.` });
          }

          if (action === "cosechar") {
            if (now() < p.nextHarvestAt) {
              return interaction.reply({ ephemeral: true, content: `Aún no toca. Próxima cosecha ${relTs(p.nextHarvestAt)}.` });
            }

            const newCount = (p.harvestCount || 0) + 1;

            if (newCount >= MAX_COSECHAS) {
              updatePlant({
                id: p.id,
                harvestCount: newCount,
                completed: true,
                completedAt: now(),
                alertedHarvest: true,
                alertedWater: true,
              });

              logReg({ type: "plantacion_completada", at: now(), by: interaction.user.id, meta: { plantId: p.id, tipo: p.tipo } });

              const updated = DB.plantaciones.find(x => x.id === p.id);
              await ensurePlantMessage(updated);
              await cleanupAlertMessage(interaction.message);

              return interaction.reply({ ephemeral: false, content: `✅ Plantación #${p.id} completada (3/3) por <@${interaction.user.id}>.` });
            }

            const newHarvestAt = now() + COSECHAR_MS;
            updatePlant({ id: p.id, harvestCount: newCount, nextHarvestAt: newHarvestAt, alertedHarvest: false });

            logReg({ type: "plantacion_cosechada", at: now(), by: interaction.user.id, meta: { plantId: p.id, count: newCount } });

            const updated = DB.plantaciones.find(x => x.id === p.id);
            await ensurePlantMessage(updated);
            await cleanupAlertMessage(interaction.message);

            return interaction.reply({ ephemeral: false, content: `🧺 Plantación #${p.id} cosechada por <@${interaction.user.id}> (**${newCount}/${MAX_COSECHAS}**). Próxima: ${relTs(newHarvestAt)}.` });
          }
        }
      }

      // Chester
      if (id.startsWith("chester_")) {
        const [, job, userId] = id.split("_");

        if (interaction.user.id !== userId) {
          return interaction.reply({ ephemeral: true, content: "🔒 Este panel es personal. Usá **/chester** para el tuyo." });
        }
        if (!CHESTER_JOBS.includes(job)) {
          return interaction.reply({ ephemeral: true, content: "Trabajo inválido." });
        }

        if (!DB.chester[userId]) DB.chester[userId] = {};

        const nextTs = DB.chester[userId][job] || 0;
        if (now() < nextTs) {
          return interaction.reply({ ephemeral: true, content: `⏳ Aún en cooldown. Disponible ${relTs(nextTs)}.` });
        }

        const newTs = now() + CHESTER_CD_MS;

        DB.chester[userId][job] = newTs;
        // ✅ resetea el notifiedTs para este nuevo cooldown (si tenía el anterior guardado)
        DB.chester[userId][`${job}_notifiedTs`] = 0;

        saveJSON("chester.json", DB.chester);

        logReg({ type: "chester_job", at: now(), by: interaction.user.id, meta: { job } });

        // ✅ update del mensaje + guardado del panel por si fue editado/movido
        DB.chesterPanels[userId] = { channelId: interaction.channelId, messageId: interaction.message.id };
        saveJSON("chester_panels.json", DB.chesterPanels);

        return interaction.update({
          embeds: [chesterEmbed(userId)],
          components: chesterButtons(userId),
        });
      }
    }
  } catch (err) {
    console.error("interaction error", err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ ephemeral: true, content: "Ocurrió un error." }); } catch {}
    }
  }
});

// =====================
// READY
// =====================
client.once("ready", async () => {
  console.log(`🤖 Bot listo: ${client.user.tag}`);

  ensureTramportistaWindow();

  for (const p of DB.plantaciones) {
    await ensurePlantMessage(p);
  }
});

(async () => {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error("❌ Falta TOKEN / CLIENT_ID / GUILD_ID en variables de entorno.");
    process.exit(1);
  }

  await registerCommands();
  await client.login(TOKEN);
})();




