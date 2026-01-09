// index.js - Maleficis Plantaciones + Chester + Tienda (Railway ready)
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
const DUPLICAR_MS = 3 * 60 * 60 * 1000;      // 3h
const REGAR_MS = (2 * 60 + 40) * 60 * 1000;  // 2h 40m
const COSECHAR_MS = 3 * 60 * 60 * 1000;      // 3h
const MAX_COSECHAS = 3;

// Chester
const CHESTER_JOBS = [
  "molotov",
  "parking",
  "ventanillas",
  "ruedas",
  "grafitis",
  "peleas",
  "transporte",
  "coche",
];
const CHESTER_CD_MS = 24 * 60 * 60 * 1000; // 24h

// Tienda
const TIENDA_CD_SOLO_MS = 5 * 60 * 60 * 1000;  // 5h
const TIENDA_CD_GRUPO_MS = 2 * 60 * 60 * 1000; // 2h
// Reinicios ARG: 00:00 / 08:00 / 16:00
const TIENDA_RESET_HOURS = [0, 8, 16]; // horario local ARG (si Railway corre en UTC, usamos TZ)

// Use TZ Argentina en Railway: TZ=America/Argentina/Buenos_Aires
// (ponelo en Variables del servicio)

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
  chester: loadJSON("chester.json", {}), // { userId: { jobName: nextReadyTs } }
  tienda: loadJSON("tienda.json", {}),   // { userId: { key: nextReadyTs } }
  registro: loadJSON("registro.json", []),
};

function logReg(entry) {
  DB.registro.push(entry);
  saveJSON("registro.json", DB.registro);
}

function now() { return Date.now(); }
function toUnix(ms) { return Math.floor(ms / 1000); }
function relTs(ms) { return `<t:${toUnix(ms)}:R>`; } // "in 2 hours" auto-updates client-side
function absTs(ms) { return `<t:${toUnix(ms)}:f>`; } // full date

function fmtTipo(tipo) {
  return tipo === "duplicar" ? "Duplicar semillas" : "Cosecha";
}

function nextPlantId() {
  const max = DB.plantaciones.reduce((m, p) => Math.max(m, p.id), 0);
  return max + 1;
}

function getPlantByNumber(n) {
  // list order is by id asc
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
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

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
    .setDescription("Abrir panel de trabajos de Chester (CD 24h por trabajo)"),

  new SlashCommandBuilder()
    .setName("tienda")
    .setDescription("Iniciar cooldown de robo a tienda (solo/grupo)")
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
        .setDescription("Nombre/tienda (ej: 24/7, armería, joyería)")
        .setRequired(true)
    ),

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

// Register commands on start
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
function plantEmbed(p) {
  const created = p.createdAt ?? now();

  const e = new EmbedBuilder()
    .setTitle(`Plantación #${p.id}`)
    .setColor(p.tipo === "duplicar" ? 0x2ecc71 : 0x3498db)
    .setFooter({ text: "Maleficis • Plantaciones" })
    .setTimestamp(new Date(created));

  const desc = (p.descripcion && p.descripcion.trim().length > 0)
    ? p.descripcion.trim()
    : "Sin descripción.";

  e.addFields(
    { name: "Descripción", value: desc, inline: false },
    { name: "Tipo", value: fmtTipo(p.tipo), inline: true },
    { name: "Plantó", value: `<@${p.createdBy}>`, inline: true },
    { name: "Creada", value: absTs(created), inline: false },
  );

  // Status + next actions
  if (p.tipo === "duplicar") {
    const readyAt = p.readyAt;
    const isReady = now() >= readyAt;
    e.addFields(
      { name: "Estado", value: isReady ? "✅ Lista para cultivar" : "🌱 Creciendo", inline: true },
      { name: "Cultivar", value: isReady ? "Ahora" : relTs(readyAt), inline: true },
    );
  } else {
    const regarAt = p.nextWaterAt;
    const cosecharAt = p.nextHarvestAt;
    e.addFields(
      { name: "Estado", value: `Cosechas: **${p.harvestCount}/${MAX_COSECHAS}**`, inline: false },
      { name: "Próximo riego", value: relTs(regarAt), inline: true },
      { name: "Próxima cosecha", value: relTs(cosecharAt), inline: true },
    );
  }

  if (p.imageUrl) e.setImage(p.imageUrl);

  return e;
}

function chesterEmbed(userId) {
  const e = new EmbedBuilder()
    .setTitle("Chester • Trabajos")
    .setDescription("Marcá el trabajo que hiciste. Se te avisará cuando vuelva a estar disponible.")
    .setColor(0x9b59b6)
    .setFooter({ text: "Maleficis • Chester" });

  const lines = CHESTER_JOBS.map(job => {
    const nextTs = DB.chester?.[userId]?.[job] || 0;
    const available = now() >= nextTs;
    return available
      ? `• **${job}** — ✅ disponible`
      : `• **${job}** — ⏳ ${relTs(nextTs)}`;
  });

  e.addFields({ name: "Estado", value: lines.join("\n"), inline: false });
  return e;
}

function tiendaEmbed(userId, modo, nombre, nextTs) {
  const e = new EmbedBuilder()
    .setTitle("Robo a tienda • Cooldown")
    .setColor(0xe67e22)
    .setFooter({ text: "Maleficis • Tiendas" });

  e.addFields(
    { name: "Usuario", value: `<@${userId}>`, inline: true },
    { name: "Modo", value: modo === "grupo" ? "Grupo (2h)" : "Solo (5h)", inline: true },
    { name: "Tienda", value: nombre, inline: false },
    { name: "Disponible", value: relTs(nextTs), inline: true },
  );

  return e;
}

// Buttons builders
function plantButtons(p) {
  // IMPORTANT: only show buttons when corresponding alert is sent
  const row = new ActionRowBuilder();

  if (p.tipo === "duplicar") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`plant_cultivar_${p.id}`)
        .setLabel("Cultivar")
        .setStyle(ButtonStyle.Success)
    );
    return [row];
  }

  // Cosecha: may show regar and/or cosechar depending alert type
  // We'll build in alert sender, not here.
  return [];
}

function chesterButtons(userId) {
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let countInRow = 0;

  for (const job of CHESTER_JOBS) {
    const nextTs = DB.chester?.[userId]?.[job] || 0;
    const available = now() >= nextTs;

    const btn = new ButtonBuilder()
      .setCustomId(`chester_${job}_${userId}`)
      .setLabel(job)
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

function registroButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("registro_borrar")
        .setLabel("Borrar registro")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

// =====================
// ALERTS / SCHEDULERS
// =====================
async function ensurePlantMessage(p) {
  const ch = await safeFetchChannel(client, p.channelId);
  if (!ch) return;

  // if message exists, edit it. else create it.
  let msg = null;
  if (p.messageId) msg = await safeFetchMessage(ch, p.messageId);

  const embed = plantEmbed(p);

  if (msg) {
    await msg.edit({ embeds: [embed] }).catch(() => {});
  } else {
    const sent = await ch.send({ embeds: [embed] }).catch(() => null);
    if (sent) {
      updatePlant({ id: p.id, messageId: sent.id });
    }
  }
}

async function deletePlantMessage(p) {
  const ch = await safeFetchChannel(client, p.channelId);
  if (!ch || !p.messageId) return;
  const msg = await safeFetchMessage(ch, p.messageId);
  if (msg) await msg.delete().catch(() => {});
}

// Send alert when time reached (buttons appear ONLY here)
async function sendPlantAlert(p, kind) {
  const ch = await safeFetchChannel(client, p.channelId);
  if (!ch) return;

  const embed = plantEmbed(p);

  // Build only relevant buttons
  const rows = [];
  if (p.tipo === "duplicar") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`plant_cultivar_${p.id}`)
          .setLabel("Cultivar")
          .setStyle(ButtonStyle.Success)
      )
    );
  } else {
    const row = new ActionRowBuilder();
    if (kind === "regar") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`plant_regar_${p.id}`)
          .setLabel("Regar")
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (kind === "cosechar") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`plant_cosechar_${p.id}`)
          .setLabel("Cosechar")
          .setStyle(ButtonStyle.Success)
      );
    }
    rows.push(row);
  }

  const ping = "@here";
  const title =
    p.tipo === "duplicar"
      ? `🌿 ${ping} Plantación #${p.id} lista para **cultivar**`
      : (kind === "regar"
          ? `💧 ${ping} Plantación #${p.id} necesita **riego**`
          : `🧺 ${ping} Plantación #${p.id} lista para **cosechar**`);

  await ch.send({ content: title, embeds: [embed], components: rows }).catch(() => {});
}

// Main loop checks each 20s
setInterval(async () => {
  // Plantaciones: check due alerts
  for (const p of DB.plantaciones) {
    try {
      // keep main embed message updated (timestamps auto-update, but harvest count etc might change)
      // We can refresh this every ~2 minutes; but ok to do lightweight edit occasionally.
      // We'll only edit when something changed via actions; so here we skip.
      // (kept for future)

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

  // Chester: remind users when a job becomes ready
  for (const userId of Object.keys(DB.chester)) {
    for (const job of Object.keys(DB.chester[userId] || {})) {
      const ts = DB.chester[userId][job];
      if (ts && !DB.chester[userId][`${job}_notified`] && now() >= ts) {
        DB.chester[userId][`${job}_notified`] = true;
        saveJSON("chester.json", DB.chester);

        try {
          const user = await client.users.fetch(userId);
          await user.send(`✅ Ya puedes hacer el trabajo de **${job}**.`);
        } catch {}
      }
    }
  }

  // Tienda: remind users when a cooldown becomes ready
  for (const userId of Object.keys(DB.tienda)) {
    for (const key of Object.keys(DB.tienda[userId] || {})) {
      const ts = DB.tienda[userId][key];
      if (ts && !DB.tienda[userId][`${key}_notified`] && now() >= ts) {
        DB.tienda[userId][`${key}_notified`] = true;
        saveJSON("tienda.json", DB.tienda);
        const [modo, nombre] = key.split("|");

        try {
          const user = await client.users.fetch(userId);
          await user.send(`🏪 Ya puedes volver a hacer **robo a tienda** (${modo}) en **${nombre}**.`);
        } catch {}
      }
    }
  }

}, 20 * 1000);

// Tienda resets at 00/08/16 ARG: check every minute
setInterval(() => {
  const d = new Date();
  const hour = d.getHours();
  const min = d.getMinutes();

  if (min !== 0) return;
  if (!TIENDA_RESET_HOURS.includes(hour)) return;

  // Clear tienda cooldowns only (and their notified flags)
  DB.tienda = {};
  saveJSON("tienda.json", DB.tienda);
  logReg({ type: "tienda_reset", at: now(), by: "system", meta: { hour } });
  console.log(`🟧 Tienda cooldowns reseteados por reinicio horario (${hour}:00).`);
}, 60 * 1000);

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {
  try {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === "plantacion") {
        const tipo = interaction.options.getString("tipo", true); // cosecha | duplicar
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

          // state
          harvestCount: 0,
          readyAt: null,
          nextWaterAt: null,
          nextHarvestAt: null,

          alertedReady: false,
          alertedWater: false,
          alertedHarvest: false,
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
          content: `✅ Plantación creada como **${fmtTipo(tipo)}** (#${p.id}). Se dejó su embed en este canal.`,
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
          if (p.tipo === "duplicar") {
            const ready = now() >= p.readyAt ? "✅ lista" : relTs(p.readyAt);
            return `**#${num}** → Plantación **#${p.id}** • **Duplicar** • ${p.descripcion || "Sin descripción"} • Cultivar: ${ready}`;
          } else {
            return `**#${num}** → Plantación **#${p.id}** • **Cosecha** • ${p.descripcion || "Sin descripción"} • Riego: ${relTs(p.nextWaterAt)} • Cosecha: ${relTs(p.nextHarvestAt)} • (${p.harvestCount}/${MAX_COSECHAS})`;
          }
        });

        const e = new EmbedBuilder()
          .setTitle("Plantaciones activas")
          .setColor(0x95a5a6)
          .setDescription(lines.join("\n"))
          .setFooter({ text: "Usa /borrarplantacion numero:X si querés eliminar una." });

        return interaction.reply({ ephemeral: true, embeds: [e] });
      }

      if (name === "borrarplantacion") {
        const numero = interaction.options.getInteger("numero", true);
        const p = getPlantByNumber(numero);
        if (!p) return interaction.reply({ ephemeral: true, content: "No existe esa plantación en la lista." });

        await deletePlantMessage(p);
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

        return interaction.reply({ ephemeral: true, embeds: [e], components: rows });
      }

      if (name === "tienda") {
        const modo = interaction.options.getString("modo", true); // solo|grupo
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

      if (name === "registro") {
        const usuario = interaction.options.getUser("usuario");

        const entries = DB.registro.slice(); // all
        const filtered = usuario
          ? entries.filter(e => e.by === usuario.id || e.meta?.userId === usuario.id)
          : entries;

        if (filtered.length === 0) {
          return interaction.reply({ ephemeral: true, content: "No hay registros para mostrar." });
        }

        // Group by user
        const byUser = {};
        for (const e of filtered) {
          const u = e.by || "system";
          if (!byUser[u]) byUser[u] = [];
          byUser[u].push(e);
        }

        const blocks = Object.entries(byUser).map(([u, arr]) => {
          const who = u === "system" ? "**Sistema**" : `<@${u}>`;
          const lines = arr
            .sort((a, b) => a.at - b.at)
            .slice(-25) // limit per user to avoid huge messages
            .map(ev => {
              const when = absTs(ev.at);
              const t = ev.type;

              let detail = "";
              if (t.startsWith("plantacion")) detail = ev.meta?.plantId ? `(#${ev.meta.plantId})` : "";
              if (t.startsWith("chester")) detail = ev.meta?.job ? `(${ev.meta.job})` : "";
              if (t.startsWith("tienda")) detail = ev.meta?.nombre ? `(${ev.meta.modo} • ${ev.meta.nombre})` : "";
              return `• ${when} — **${t}** ${detail}`.trim();
            });

          return { who, lines };
        });

        const e = new EmbedBuilder()
          .setTitle(usuario ? `Registro • ${usuario.username}` : "Registro • General")
          .setColor(0x34495e)
          .setDescription("Resumen por usuario (últimos eventos por usuario).");

        for (const b of blocks.slice(0, 8)) {
          e.addFields({ name: b.who, value: b.lines.join("\n").slice(0, 1024) || "—", inline: false });
        }

        return interaction.reply({
          ephemeral: true,
          embeds: [e],
          components: registroButtons(),
        });
      }
    }

    // Buttons
    if (interaction.isButton()) {
      const id = interaction.customId;

      // ===== Plantaciones =====
      if (id.startsWith("plant_")) {
        const parts = id.split("_"); // plant_action_id
        const action = parts[1];
        const plantId = parseInt(parts[2], 10);

        const p = DB.plantaciones.find(x => x.id === plantId);
        if (!p) return interaction.reply({ ephemeral: true, content: "Esa plantación ya no existe." });

        // duplicar -> cultivar only if ready
        if (p.tipo === "duplicar" && action === "cultivar") {
          if (now() < p.readyAt) {
            return interaction.reply({ ephemeral: true, content: `Aún no está lista. Cultivar ${relTs(p.readyAt)}.` });
          }

          // log + delete embed + remove
          logReg({ type: "plantacion_cultivada", at: now(), by: interaction.user.id, meta: { plantId: p.id } });

          await deletePlantMessage(p);
          removePlant(p.id);

          return interaction.reply({ ephemeral: false, content: `🌿 Plantación #${p.id} cultivada por <@${interaction.user.id}>. ✅` });
        }

        // cosecha -> regar / cosechar
        if (p.tipo === "cosecha") {
          if (action === "regar") {
            if (now() < p.nextWaterAt) {
              return interaction.reply({ ephemeral: true, content: `Aún no toca. Próximo riego ${relTs(p.nextWaterAt)}.` });
            }

            const newWaterAt = now() + REGAR_MS;
            updatePlant({
              id: p.id,
              nextWaterAt: newWaterAt,
              alertedWater: false, // allow next alert
            });

            logReg({ type: "plantacion_regada", at: now(), by: interaction.user.id, meta: { plantId: p.id } });

            // update embed message
            const updated = DB.plantaciones.find(x => x.id === p.id);
            await ensurePlantMessage(updated);

            return interaction.reply({ ephemeral: false, content: `💧 Plantación #${p.id} regada por <@${interaction.user.id}>. Próximo riego ${relTs(newWaterAt)}.` });
          }

          if (action === "cosechar") {
            if (now() < p.nextHarvestAt) {
              return interaction.reply({ ephemeral: true, content: `Aún no toca. Próxima cosecha ${relTs(p.nextHarvestAt)}.` });
            }

            const newCount = (p.harvestCount || 0) + 1;

            logReg({ type: "plantacion_cosechada", at: now(), by: interaction.user.id, meta: { plantId: p.id, count: newCount } });

            if (newCount >= MAX_COSECHAS) {
              // done: delete embed + remove
              await deletePlantMessage(p);
              removePlant(p.id);

              return interaction.reply({ ephemeral: false, content: `🧺 Plantación #${p.id} cosechada por **3ra vez** por <@${interaction.user.id}>. ✅ Plantación finalizada.` });
            }

            const newHarvestAt = now() + COSECHAR_MS;
            updatePlant({
              id: p.id,
              harvestCount: newCount,
              nextHarvestAt: newHarvestAt,
              alertedHarvest: false, // allow next alert
            });

            const updated = DB.plantaciones.find(x => x.id === p.id);
            await ensurePlantMessage(updated);

            return interaction.reply({ ephemeral: false, content: `🧺 Plantación #${p.id} cosechada por <@${interaction.user.id}> (**${newCount}/${MAX_COSECHAS}**). Próxima: ${relTs(newHarvestAt)}.` });
          }
        }

        return;
      }

      // ===== Chester =====
      if (id.startsWith("chester_")) {
        const [, job, userId] = id.split("_");
        if (interaction.user.id !== userId) {
          return interaction.reply({ ephemeral: true, content: "Este panel es personal. Usá /chester para el tuyo." });
        }

        if (!CHESTER_JOBS.includes(job)) {
          return interaction.reply({ ephemeral: true, content: "Trabajo inválido." });
        }

        if (!DB.chester[userId]) DB.chester[userId] = {};
        const nextTs = DB.chester[userId][job] || 0;
        if (now() < nextTs) {
          return interaction.reply({ ephemeral: true, content: `Aún en cooldown. Disponible ${relTs(nextTs)}.` });
        }

        DB.chester[userId][job] = now() + CHESTER_CD_MS;
        DB.chester[userId][`${job}_notified`] = false;
        saveJSON("chester.json", DB.chester);

        logReg({ type: "chester_job", at: now(), by: interaction.user.id, meta: { job } });

        // update panel
        const e = chesterEmbed(userId);
        const rows = chesterButtons(userId);

        return interaction.update({
          embeds: [e],
          components: rows,
        });
      }

      // ===== Registro =====
      if (id === "registro_borrar") {
        // only admins
        const member = interaction.member;
        const isAdmin = member?.permissions?.has?.(PermissionFlagsBits.Administrator);
        if (!isAdmin) return interaction.reply({ ephemeral: true, content: "Solo administradores." });

        DB.registro = [];
        saveJSON("registro.json", DB.registro);

        return interaction.update({
          embeds: [new EmbedBuilder().setTitle("Registro").setDescription("🗑️ Registro eliminado.").setColor(0x2ecc71)],
          components: [],
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

  // ensure all plant embeds exist
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


