// index.js
// Bot Plantaciones (Cosecha/Duplicar) + Registro Admin por usuario
// discord.js v14

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
  ChannelType,
  AttachmentBuilder
} = require("discord.js");

// =========================
// ENV
// =========================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("[FATAL] Falta TOKEN, CLIENT_ID o GUILD_ID en variables de entorno.");
  process.exit(1);
}

// =========================
// DATA (JSON)
// =========================
const DATA_DIR = path.join(__dirname, "data");
const PLANTS_FILE = path.join(DATA_DIR, "plantaciones.json");
const LOG_FILE = path.join(DATA_DIR, "registro.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
ensureDataDir();

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("[DATA] Error leyendo", file, e);
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("[DATA] Error guardando", file, e);
  }
}

// Estructura:
// plantaciones = [{ id, tipo, descripcion, imageUrl, createdBy, createdAt, embedChannelId, embedMessageId, notifyChannelId,
//                  nextWaterAt, nextHarvestAt, harvestCount, done, lastAlertMessageId }]
let plantaciones = loadJSON(PLANTS_FILE, []);
let registro = loadJSON(LOG_FILE, []); // [{ts, userId, userTag, action, details}]

// Genera ID incremental simple
function nextPlantId() {
  const max = plantaciones.reduce((m, p) => Math.max(m, p.id), 0);
  return max + 1;
}

// =========================
// TIEMPOS
// =========================
const MS = 1000;
const MIN = 60 * MS;
const HOUR = 60 * MIN;

const WATER_INTERVAL = (2 * HOUR) + (40 * MIN); // 2:40
const HARVEST_INTERVAL = 3 * HOUR;              // 3:00
const DUPLICATE_READY = 3 * HOUR;               // 3:00

function now() { return Date.now(); }

function fmtMs(ms) {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function fmtDate(ts) {
  // Argentina (aprox, Discord mostrará bien por timestamp)
  const d = new Date(ts);
  return d.toLocaleString("es-AR", { hour12: false });
}

function addLog(user, action, details) {
  const entry = {
    ts: now(),
    userId: user.id,
    userTag: `${user.username}${user.discriminator ? "#" + user.discriminator : ""}`,
    action,
    details
  };
  registro.push(entry);
  saveJSON(LOG_FILE, registro);
}

// =========================
// EMBEDS
// =========================
function baseColor(tipo) {
  return tipo === "duplicar" ? 0x2bb673 : 0x3aa0ff;
}

function buildPlantEmbed(p) {
  const tipoNombre = p.tipo === "duplicar" ? "Duplicar semillas" : "Cosecha";
  const e = new EmbedBuilder()
    .setColor(baseColor(p.tipo))
    .setTitle(`Plantación #${p.id}`)
    .setDescription(p.descripcion ? p.descripcion : "Sin descripción")
    .addFields(
      { name: "Tipo", value: tipoNombre, inline: true },
      { name: "Plantó", value: `<@${p.createdBy}>`, inline: true },
      { name: "Creada", value: `${fmtDate(p.createdAt)}`, inline: false }
    )
    .setFooter({ text: "Maleficis • Plantaciones" });

  if (p.imageUrl) e.setImage(p.imageUrl);

  // Estado
  if (p.done) {
    e.addFields({ name: "Estado", value: "Finalizada ✅", inline: false });
    return e;
  }

  if (p.tipo === "duplicar") {
    const remaining = (p.createdAt + DUPLICATE_READY) - now();
    e.addFields(
      { name: "Estado", value: remaining <= 0 ? "Lista para cultivar 🌿" : "Creciendo", inline: true },
      { name: "Cultivar en", value: remaining <= 0 ? "Disponible" : fmtMs(remaining), inline: true }
    );
  } else {
    const wRem = p.nextWaterAt - now();
    const hRem = p.nextHarvestAt - now();
    const waterTxt = wRem <= 0 ? "Disponible" : fmtMs(wRem);
    const harvestTxt = hRem <= 0 ? "Disponible" : fmtMs(hRem);

    e.addFields(
      { name: "Riego", value: waterTxt, inline: true },
      { name: "Cosecha", value: harvestTxt, inline: true },
      { name: "Cosechas", value: `${p.harvestCount}/3`, inline: true }
    );
  }

  return e;
}

// Aviso “limpio” (borra el aviso anterior de esa plantación, si existe)
async function sendCleanAlert(client, p, content, components) {
  const chId = p.notifyChannelId || p.embedChannelId;
  const ch = await client.channels.fetch(chId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) return;

  // borrar alerta previa
  if (p.lastAlertMessageId) {
    const old = await ch.messages.fetch(p.lastAlertMessageId).catch(() => null);
    if (old) await old.delete().catch(() => null);
  }

  const msg = await ch.send({ content, components }).catch(() => null);
  if (msg) {
    p.lastAlertMessageId = msg.id;
    saveJSON(PLANTS_FILE, plantaciones);
  }
}

function btn(customId, label, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function actionRow(buttons) {
  return new ActionRowBuilder().addComponents(buttons);
}

async function updatePlantEmbed(client, p) {
  const ch = await client.channels.fetch(p.embedChannelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) return;
  const msg = await ch.messages.fetch(p.embedMessageId).catch(() => null);
  if (!msg) return;

  const embed = buildPlantEmbed(p);
  await msg.edit({ embeds: [embed] }).catch(() => null);
}

async function deletePlantEmbed(client, p) {
  const ch = await client.channels.fetch(p.embedChannelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) return;
  const msg = await ch.messages.fetch(p.embedMessageId).catch(() => null);
  if (msg) await msg.delete().catch(() => null);

  // también borra la última alerta si existe
  const notifyId = p.notifyChannelId || p.embedChannelId;
  const nch = await client.channels.fetch(notifyId).catch(() => null);
  if (nch && nch.type === ChannelType.GuildText && p.lastAlertMessageId) {
    const old = await nch.messages.fetch(p.lastAlertMessageId).catch(() => null);
    if (old) await old.delete().catch(() => null);
  }
}

// =========================
// SCHEDULER (chequea plantaciones)
// =========================
async function tick(client) {
  const t = now();
  let changed = false;

  for (const p of plantaciones) {
    if (p.done) continue;

    if (p.tipo === "duplicar") {
      const readyAt = p.createdAt + DUPLICATE_READY;
      if (t >= readyAt) {
        // manda aviso (solo botón cultivar)
        const row = actionRow([
          btn(`plant:harvest:${p.id}`, "Cultivar", ButtonStyle.Success),
        ]);

        await sendCleanAlert(
          client,
          p,
          `@here 🌿 **Plantación #${p.id}** lista para **cultivar**.`,
          [row]
        );

        // actualiza embed para mostrar "Disponible"
        await updatePlantEmbed(client, p);
      }
    } else {
      // Cosecha: avisos separados según lo que toque
      const needsWater = t >= p.nextWaterAt;
      const needsHarvest = t >= p.nextHarvestAt;

      // Si ambas a la vez, avisamos ambas y mostramos dos botones
      if (needsWater || needsHarvest) {
        const buttons = [];
        if (needsWater) buttons.push(btn(`plant:water:${p.id}`, "Regar", ButtonStyle.Primary));
        if (needsHarvest) buttons.push(btn(`plant:harvest:${p.id}`, "Cosechar", ButtonStyle.Success));

        const row = actionRow(buttons);

        const msgBits = [];
        if (needsWater) msgBits.push("regar");
        if (needsHarvest) msgBits.push("cosechar");

        await sendCleanAlert(
          client,
          p,
          `@here 🌱 **Plantación #${p.id}** lista para **${msgBits.join(" y ")}**.`,
          [row]
        );

        await updatePlantEmbed(client, p);
      }
    }
  }

  if (changed) {
    saveJSON(PLANTS_FILE, plantaciones);
  }
}

// Corre cada 20s (sin spam)
function startScheduler(client) {
  setInterval(() => tick(client).catch(console.error), 20 * 1000);
}

// =========================
// SLASH COMMANDS
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName("plantacion")
    .setDescription("Crear una plantación (cosecha o duplicar)")
    .addStringOption(o =>
      o.setName("tipo")
        .setDescription("Tipo de plantación")
        .setRequired(true)
        .addChoices(
          { name: "Cosecha", value: "cosecha" },
          { name: "Duplicar semillas", value: "duplicar" }
        )
    )
    .addStringOption(o =>
      o.setName("descripcion")
        .setDescription("Descripción opcional (ej: Puerta, Garaje...)")
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName("canal_embed")
        .setDescription("Canal donde quedará el embed fijo de la plantación (opcional)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName("canal_alertas")
        .setDescription("Canal donde avisará @here cuando toque (opcional)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addAttachmentOption(o =>
      o.setName("imagen")
        .setDescription("Imagen opcional")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("plantaciones")
    .setDescription("Ver lista de plantaciones activas"),

  new SlashCommandBuilder()
    .setName("borrarplantacion")
    .setDescription("Borrar plantación por número (#1, #2...)")
    .addIntegerOption(o =>
      o.setName("numero")
        .setDescription("Número de la plantación (ej: 1)")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("registro")
    .setDescription("Ver registro de actividad (ADMIN). Opcional: filtrar por usuario.")
    .addUserOption(o =>
      o.setName("usuario")
        .setDescription("Usuario a consultar (opcional)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map(c => c.toJSON());

// =========================
// DISCORD CLIENT
// =========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

// =========================
// REGISTER COMMANDS
// =========================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("[OK] Slash commands registrados en el servidor.");
}

// =========================
// HELPERS
// =========================
function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function findPlantById(id) {
  return plantaciones.find(p => p.id === id && !p.done);
}

function listEmbed() {
  const e = new EmbedBuilder()
    .setColor(0x8b8b8b)
    .setTitle("Plantaciones activas")
    .setFooter({ text: "Maleficis • Plantaciones" });

  const active = plantaciones.filter(p => !p.done);
  if (!active.length) {
    e.setDescription("No hay plantaciones activas.");
    return e;
  }

  const lines = active.map(p => {
    const tipo = p.tipo === "duplicar" ? "Duplicar" : "Cosecha";
    let extra = "";
    if (p.tipo === "duplicar") {
      const rem = (p.createdAt + DUPLICATE_READY) - now();
      extra = rem <= 0 ? "Cultivar: disponible" : `Cultivar en: ${fmtMs(rem)}`;
    } else {
      const w = p.nextWaterAt - now();
      const h = p.nextHarvestAt - now();
      extra = `Riego: ${w <= 0 ? "disponible" : fmtMs(w)} • Cosecha: ${h <= 0 ? "disponible" : fmtMs(h)} • ${p.harvestCount}/3`;
    }
    return `**#${p.id}** • ${tipo}${p.descripcion ? ` • ${p.descripcion}` : ""}\n${extra}`;
  });

  e.setDescription(lines.join("\n\n"));
  return e;
}

function registroEmbedAll(filterUser) {
  const e = new EmbedBuilder()
    .setColor(0x222222)
    .setTitle(filterUser ? `Registro • ${filterUser.tag}` : "Registro • Todos")
    .setFooter({ text: "Maleficis • Registro" });

  const items = filterUser
    ? registro.filter(r => r.userId === filterUser.id)
    : registro;

  if (!items.length) {
    e.setDescription("No hay registro todavía.");
    return e;
  }

  // Agrupar por usuario
  const byUser = new Map();
  for (const r of items) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, { tag: r.userTag, rows: [] });
    byUser.get(r.userId).rows.push(r);
  }

  // Para “todos”: mostramos resumen por usuario con últimas acciones
  if (!filterUser) {
    const chunks = [];
    for (const [uid, data] of byUser.entries()) {
      const rows = data.rows.slice(-6).reverse(); // últimas 6
      const text = rows.map(x => `• **${fmtDate(x.ts)}** — ${x.action} (${x.details})`).join("\n");
      chunks.push({ name: `${data.tag} (${data.rows.length})`, value: text || "—" });
    }

    // Discord embed fields límite: 25
    for (const f of chunks.slice(0, 25)) e.addFields(f);

    if (chunks.length > 25) {
      e.addFields({ name: "Nota", value: `Mostrando 25 usuarios (hay ${chunks.length}). Filtrá con \`/registro usuario:@...\`` });
    }

    return e;
  }

  // Para usuario: lista detallada (últimos 25)
  const rows = items.slice(-25).reverse();
  e.setDescription(rows.map(x => `• **${fmtDate(x.ts)}** — **${x.action}** (${x.details})`).join("\n"));
  return e;
}

// Botón para limpiar registro
function registroControlsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("log:clear")
      .setLabel("Limpiar registro")
      .setStyle(ButtonStyle.Danger)
  );
}

// =========================
// EVENTS
// =========================
client.once("ready", async () => {
  console.log(`[OK] Bot listo: ${client.user.tag}`);
  await registerCommands().catch(console.error);
  startScheduler(client);

  // al arrancar, refresca embeds (por si quedó desincronizado)
  for (const p of plantaciones.filter(x => !x.done)) {
    updatePlantEmbed(client, p).catch(() => null);
  }
});

// Slash commands
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === "plantacion") {
        const tipo = interaction.options.getString("tipo", true);
        const descripcion = interaction.options.getString("descripcion") || "";
        const canalEmbed = interaction.options.getChannel("canal_embed") || interaction.channel;
        const canalAlertas = interaction.options.getChannel("canal_alertas") || interaction.channel;
        const imagen = interaction.options.getAttachment("imagen");

        if (!canalEmbed || canalEmbed.type !== ChannelType.GuildText) {
          return interaction.reply({ content: "Ese canal de embed no es válido.", ephemeral: true });
        }
        if (!canalAlertas || canalAlertas.type !== ChannelType.GuildText) {
          return interaction.reply({ content: "Ese canal de alertas no es válido.", ephemeral: true });
        }

        const p = {
          id: nextPlantId(),
          tipo,
          descripcion,
          imageUrl: imagen?.url || null,
          createdBy: interaction.user.id,
          createdAt: now(),
          embedChannelId: canalEmbed.id,
          embedMessageId: null,
          notifyChannelId: canalAlertas.id,
          nextWaterAt: tipo === "cosecha" ? now() + WATER_INTERVAL : null,
          nextHarvestAt: tipo === "cosecha" ? now() + HARVEST_INTERVAL : null,
          harvestCount: 0,
          done: false,
          lastAlertMessageId: null,
        };

        // crea embed fijo
        const embed = buildPlantEmbed(p);
        const msg = await canalEmbed.send({ embeds: [embed] });

        p.embedMessageId = msg.id;
        plantaciones.push(p);
        saveJSON(PLANTS_FILE, plantaciones);

        addLog(interaction.user, "Creó plantación", `#${p.id} • ${tipo}${descripcion ? " • " + descripcion : ""}`);

        await interaction.reply({
          content: `✅ Plantación **#${p.id}** creada. Embed: <#${canalEmbed.id}> • Alertas: <#${canalAlertas.id}>`,
          ephemeral: true
        });

        return;
      }

      if (commandName === "plantaciones") {
        return interaction.reply({ embeds: [listEmbed()], ephemeral: true });
      }

      if (commandName === "borrarplantacion") {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "No tenés permisos.", ephemeral: true });
        }
        const numero = interaction.options.getInteger("numero", true);
        const idx = plantaciones.findIndex(p => p.id === numero && !p.done);
        if (idx === -1) {
          return interaction.reply({ content: "No existe esa plantación activa.", ephemeral: true });
        }
        const p = plantaciones[idx];

        await deletePlantEmbed(client, p);
        plantaciones[idx].done = true;
        saveJSON(PLANTS_FILE, plantaciones);

        addLog(interaction.user, "Borró plantación", `#${p.id}`);

        return interaction.reply({ content: `🗑️ Plantación #${p.id} eliminada.`, ephemeral: true });
      }

      if (commandName === "registro") {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "No tenés permisos.", ephemeral: true });
        }
        const u = interaction.options.getUser("usuario");
        const emb = registroEmbedAll(u);

        return interaction.reply({
          embeds: [emb],
          components: [registroControlsRow()],
          ephemeral: true
        });
      }
    }

    // Buttons
    if (interaction.isButton()) {
      const [scope, action, idStr] = interaction.customId.split(":");

      // Limpiar registro
      if (interaction.customId === "log:clear") {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "No tenés permisos para limpiar el registro.", ephemeral: true });
        }
        registro = [];
        saveJSON(LOG_FILE, registro);
        return interaction.reply({ content: "🧹 Registro limpiado.", ephemeral: true });
      }

      if (scope !== "plant") return;

      const plantId = parseInt(idStr, 10);
      const p = findPlantById(plantId);
      if (!p) {
        return interaction.reply({ content: "Esa plantación ya no existe o fue finalizada.", ephemeral: true });
      }

      // Evitar doble click simultáneo: deshabilitamos botones del mensaje
      await interaction.deferUpdate().catch(() => null);

      if (p.tipo === "duplicar") {
        // Solo “harvest” (cultivar)
        if (action !== "harvest") {
          return interaction.followUp({ content: "Esta plantación es de duplicar: solo se puede cultivar.", ephemeral: true });
        }

        const readyAt = p.createdAt + DUPLICATE_READY;
        if (now() < readyAt) {
          return interaction.followUp({ content: "Todavía no está lista para cultivar.", ephemeral: true });
        }

        addLog(interaction.user, "Cultivó", `Plantación #${p.id}${p.descripcion ? " • " + p.descripcion : ""}`);

        // Finaliza y borra embed + alerta
        p.done = true;
        saveJSON(PLANTS_FILE, plantaciones);
        await deletePlantEmbed(client, p);

        // Aviso corto “confirmación” sin spam
        return interaction.followUp({ content: `✅ Cultivo registrado en **Plantación #${p.id}**.`, ephemeral: true });
      }

      // Cosecha
      if (p.tipo === "cosecha") {
        if (action === "water") {
          if (now() < p.nextWaterAt) {
            return interaction.followUp({ content: "Todavía no toca regar.", ephemeral: true });
          }

          p.nextWaterAt = now() + WATER_INTERVAL;
          saveJSON(PLANTS_FILE, plantaciones);

          addLog(interaction.user, "Regó", `Plantación #${p.id}${p.descripcion ? " • " + p.descripcion : ""}`);

          // Actualiza embed
          await updatePlantEmbed(client, p);

          // Borra el mensaje de alerta (limpio)
          // (al responder no necesitamos mantener el aviso)
          if (p.lastAlertMessageId) {
            const chId = p.notifyChannelId || p.embedChannelId;
            const ch = await client.channels.fetch(chId).catch(() => null);
            if (ch && ch.type === ChannelType.GuildText) {
              const old = await ch.messages.fetch(p.lastAlertMessageId).catch(() => null);
              if (old) await old.delete().catch(() => null);
            }
            p.lastAlertMessageId = null;
            saveJSON(PLANTS_FILE, plantaciones);
          }

          return interaction.followUp({ content: `💧 Riego registrado en **Plantación #${p.id}**.`, ephemeral: true });
        }

        if (action === "harvest") {
          if (now() < p.nextHarvestAt) {
            return interaction.followUp({ content: "Todavía no toca cosechar.", ephemeral: true });
          }

          p.harvestCount += 1;
          p.nextHarvestAt = now() + HARVEST_INTERVAL;
          saveJSON(PLANTS_FILE, plantaciones);

          addLog(interaction.user, "Cosechó", `Plantación #${p.id} • ${p.harvestCount}/3${p.descripcion ? " • " + p.descripcion : ""}`);

          // Si llegó a 3, finaliza
          if (p.harvestCount >= 3) {
            p.done = true;
            saveJSON(PLANTS_FILE, plantaciones);
            await deletePlantEmbed(client, p);

            return interaction.followUp({ content: `🌿 Cosecha **3/3** registrada. Plantación #${p.id} finalizada y eliminada.`, ephemeral: true });
          }

          // Si no, update embed
          await updatePlantEmbed(client, p);

          // limpia alerta
          if (p.lastAlertMessageId) {
            const chId = p.notifyChannelId || p.embedChannelId;
            const ch = await client.channels.fetch(chId).catch(() => null);
            if (ch && ch.type === ChannelType.GuildText) {
              const old = await ch.messages.fetch(p.lastAlertMessageId).catch(() => null);
              if (old) await old.delete().catch(() => null);
            }
            p.lastAlertMessageId = null;
            saveJSON(PLANTS_FILE, plantaciones);
          }

          return interaction.followUp({ content: `🌿 Cosecha registrada en **Plantación #${p.id}** (${p.harvestCount}/3).`, ephemeral: true });
        }
      }

      return interaction.followUp({ content: "Acción no válida.", ephemeral: true });
    }
  } catch (e) {
    console.error("[ERR] interactionCreate", e);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: "Ocurrió un error. Revisá Logs.", ephemeral: true });
      } catch {}
    }
  }
});

// =========================
// START
// =========================
client.login(TOKEN).catch((e) => {
  console.error("[FATAL] Login falló:", e);
  process.exit(1);
});

