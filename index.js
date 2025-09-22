require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { CronJob } = require("cron");
const fs = require("fs");
const path = require("path");


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Function to build the embed
function buildPatrolEmbed(roleId) {
  const now = Math.floor(Date.now() / 1000);

  return {
    content: `<@&${roleId}>`, // role ping
    embeds: [
      new EmbedBuilder()
        .setTitle("🚨 Patrol Notification 🚨")
        .setDescription(
          `A new patrol is beginning!\n\n**Start Time:** <t:1758490230:t>\n**AOP:** Statewide ALWAYS\n\nReact below to confirm your status:`
        )
        .setColor(0xFB3E83) // Vice Valley pink
        .setThumbnail("https://media.discordapp.net/attachments/1401241176199270541/1419424262053298206/ViceValleyLogo.png?ex=68d1b55b&is=68d063db&hm=91eda5b961aadb5beb16ff78827f0936e5088fb68f99d01017e844b99fc7ff0b&=&format=webp&quality=lossless&width=410&height=410") // top-right logo
        .setImage("https://cdn.discordapp.com/attachments/1388737486473138247/1419423721168306236/VVRP_interview_and_application_banner.png?ex=68d1b4da&is=68d0635a&hm=126e846f121cbc6d37160c7d175daac911e3687df297f6d92a6aa2bf6c04ff01&") // big bottom banner
        .setFooter({ text: "Vice Valley Roleplay • Stay safe out there!" })
        .setTimestamp(),
    ],
  };
}

// Function to send the embed
async function sendPatrolEmbed(channel) {
  const { content, embeds } = buildPatrolEmbed(process.env.ROLE_ID);
  const message = await channel.send({ content, embeds });

  // Add reactions
  await message.react("✅");
  await message.react("❓");
  await message.react("❌");

  // Auto delete after 24 hours
  setTimeout(() => {
    message.delete().catch(() => {});
  }, 24 * 60 * 60 * 1000);
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Daily schedule: 12:00 PM New York time
  new CronJob(
    "0 12 * * *",
    async () => {
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      if (channel) {
        sendPatrolEmbed(channel);
      }
    },
    null,
    true,
    "America/New_York"
  );
});

// Manual test command
client.on("messageCreate", async (message) => {
  if (message.content === "!patroltest") {
    sendPatrolEmbed(message.channel);
  }
});

// ===================== SLASH COMMANDS (ALL EMBEDS) =====================

// ---------- Files ----------
const ECO_PATH = path.join(__dirname, "economy.json");
const RPS_PATH = path.join(__dirname, "rps_leaderboard.json");

// ---------- Storage helpers ----------
function loadJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); }

// ---------- In-memory stores (persisted to disk) ----------
let eco = loadJSON(ECO_PATH, {}); // { [guildId]: { [userId]: { balance, lastDaily, lastWeekly, lastWork, job } } }
let rps = loadJSON(RPS_PATH, {}); // { [guildId]: { [userId]: wins } }

// ---------- Economy helpers ----------
function ecoSave() { saveJSON(ECO_PATH, eco); }
function rpsSave() { saveJSON(RPS_PATH, rps); }

function ensureUser(gid, uid) {
  if (!eco[gid]) eco[gid] = {};
  if (!eco[gid][uid]) eco[gid][uid] = { balance: 0, lastDaily: 0, lastWeekly: 0, lastWork: 0, job: null };
  return eco[gid][uid];
}
function getBalance(gid, uid) { return ensureUser(gid, uid).balance || 0; }
function addBalance(gid, uid, amt) { const u = ensureUser(gid, uid); u.balance = Math.max(0, (u.balance || 0) + amt); ecoSave(); return u.balance; }
function setBalance(gid, uid, amt) { const u = ensureUser(gid, uid); u.balance = Math.max(0, Math.floor(amt)); ecoSave(); return u.balance; }
function resetUser(gid, uid) { ensureUser(gid, uid); eco[gid][uid] = { balance: 0, lastDaily: 0, lastWeekly: 0, lastWork: 0, job: null }; ecoSave(); }
function resetServer(gid) { eco[gid] = {}; ecoSave(); }

// ---------- RPS helpers ----------
function rpsAddWin(gid, uid) { if (!rps[gid]) rps[gid] = {}; rps[gid][uid] = (rps[gid][uid] || 0) + 1; rpsSave(); }
function rpsTop(gid, limit = 10) { const arr = Object.entries(rps[gid] || {}); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0, limit); }

// ---------- Economy settings ----------
const DAILY_COOLDOWN_MS  = 24 * 60 * 60 * 1000;
const WEEKLY_COOLDOWN_MS = 7  * 24 * 60 * 60 * 1000;
const DAILY_REWARD  = 250;
const WEEKLY_REWARD = 1200;

// Default work if no job chosen
const WORK_MIN = 50, WORK_MAX = 150, WORK_COOLDOWN_MS = 60 * 60 * 1000;

// ---------- Jobs ----------
const JOBS = {
  courier:   { name: "Courier",    min:  60, max: 140, cooldownMin: 30, blurb: "Quick runs, steady cash." },
  bartender: { name: "Bartender",  min:  80, max: 180, cooldownMin: 45, blurb: "Tips add up on a busy night." },
  mechanic:  { name: "Mechanic",   min:  90, max: 200, cooldownMin: 45, blurb: "Grease & gears pay well." },
  developer: { name: "Developer",  min: 140, max: 280, cooldownMin: 90, blurb: "Big brain, bigger checks." },
  miner:     { name: "Miner",      min:   0, max: 420, cooldownMin: 90, blurb: "High risk, high reward." },
};
function getUserJob(gid, uid) { return ensureUser(gid, uid).job || null; }
function setUserJob(gid, uid, key) { const u = ensureUser(gid, uid); u.job = key; ecoSave(); return key; }

// ---------- Slots ----------
const SLOT_EMOJIS = ["🍒","🍋","🍇","🔔","⭐","7️⃣","💎"];
function spinSlots() {
  const r = () => SLOT_EMOJIS[Math.floor(Math.random()*SLOT_EMOJIS.length)];
  const reels = [r(), r(), r()];
  const [a,b,c] = reels;
  let mul = 0, label = "No match — better luck next time.";
  if (a === b && b === c) {
    if (a === "💎")      { mul = 15; label = "💎💎💎 **JACKPOT! x15**"; }
    else if (a === "7️⃣"){ mul = 10; label = "7️⃣7️⃣7️⃣ **Lucky sevens! x10**"; }
    else                 { mul =  5; label = "**Triple match! x5**"; }
  } else if (a === b || a === c || b === c) {
    mul = 2; label = "**Two of a kind! x2**";
  }
  return { reels, mul, label };
}

// ---------- Duel state ----------
const pendingDuels = new Map();           // key: `${guildId}:${messageId}` → { challengerId, opponentId, bet, expiresAt }
const DUEL_TIMEOUT_MS = 60 * 1000;

// ---------- Embed utilities ----------
const COLORS = {
  info:    0x5865F2,
  success: 0x57F287,
  warn:    0xFEE75C,
  error:   0xED4245,
  econ:    0xFAA81A,
  game:    0x9B59B6,
};
const eb = (title, description = "", color = COLORS.info) =>
  new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();

// ---------- Permissions ----------
function isAdmin(interaction) {
  const p = interaction.member?.permissions;
  return !!p && (p.has(PermissionsBitField.Flags.Administrator) || p.has(PermissionsBitField.Flags.ManageGuild));
}

// ---------- Command definitions ----------
const commands = [
  // Info
  new SlashCommandBuilder().setName("ping").setDescription("Replies with Pong!"),
  new SlashCommandBuilder().setName("about").setDescription("About this bot"),

  // RPS
  new SlashCommandBuilder().setName("rps").setDescription("Rock • Paper • Scissors")
    .addStringOption(o => o.setName("move").setDescription("Your move").setRequired(true)
      .addChoices({name:"Rock",value:"rock"},{name:"Paper",value:"paper"},{name:"Scissors",value:"scissors"})),
  new SlashCommandBuilder().setName("rpsleaderboard").setDescription("Top RPS winners in this server"),

  // Economy (user)
  new SlashCommandBuilder().setName("balance").setDescription("Check a balance")
    .addUserOption(o => o.setName("user").setDescription("User (defaults to you)").setRequired(false)),
  new SlashCommandBuilder().setName("daily").setDescription(`Claim your daily ${DAILY_REWARD} coins (24h cooldown)`),
  new SlashCommandBuilder().setName("weekly").setDescription(`Claim your weekly ${WEEKLY_REWARD} coins (7d cooldown)`),
  new SlashCommandBuilder().setName("work").setDescription("Work a shift to earn coins (cooldown varies by job)"),
  new SlashCommandBuilder().setName("give").setDescription("Give coins to another user")
    .addUserOption(o => o.setName("user").setDescription("Recipient").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("richest").setDescription("Show the top 10 richest users"),

  // Jobs
  new SlashCommandBuilder().setName("setjob").setDescription("Choose your job for /work payouts")
    .addStringOption(o => o.setName("job").setDescription("Pick a job").setRequired(true)
      .addChoices(
        {name:JOBS.courier.name,   value:"courier"},
        {name:JOBS.bartender.name, value:"bartender"},
        {name:JOBS.mechanic.name,  value:"mechanic"},
        {name:JOBS.developer.name, value:"developer"},
        {name:JOBS.miner.name,     value:"miner"},
      )),
  new SlashCommandBuilder().setName("job").setDescription("Show your current job"),
  new SlashCommandBuilder().setName("jobslist").setDescription("See all available jobs & payouts"),

  // Games using economy
  new SlashCommandBuilder().setName("slots").setDescription("Spin the slots and try your luck")
    .addIntegerOption(o => o.setName("bet").setDescription("Coins to bet").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("duel").setDescription("Challenge another player to a coin-flip duel")
    .addUserOption(o => o.setName("opponent").setDescription("Who to duel").setRequired(true))
    .addIntegerOption(o => o.setName("bet").setDescription("Bet amount (both pay)").setRequired(true).setMinValue(1)),

  // Admin
  new SlashCommandBuilder().setName("ecoadd").setDescription("[Admin] Add coins to a user")
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to add").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("ecoset").setDescription("[Admin] Set a user's balance")
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("New balance").setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName("ecoreset").setDescription("[Admin] Reset a user or the server economy")
    .addStringOption(o => o.setName("scope").setDescription("What to reset").setRequired(true)
      .addChoices({name:"user",value:"user"},{name:"server",value:"server"}))
    .addUserOption(o => o.setName("user").setDescription("User to reset (if scope=user)").setRequired(false)),
].map(c => c.toJSON());

// ---------- Register on startup ----------
async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log("✅ Slash commands registered.");
}
client.once("ready", async () => { await registerSlashCommands(); });

// ---------- Interaction Handlers (all embeds) ----------
client.on("interactionCreate", async (interaction) => {
  // Duel buttons
  if (interaction.isButton() && interaction.customId.startsWith("duel_")) {
    const gid = interaction.guildId;
    const action = interaction.customId.split("_")[1]; // accept / decline
    const key = `${gid}:${interaction.message.id}`;
    const duel = pendingDuels.get(key);
    if (!duel) return interaction.reply({ embeds: [eb("Duel", "This duel is no longer active.", COLORS.warn)], ephemeral: true });
    if (interaction.user.id !== duel.opponentId) return interaction.reply({ embeds: [eb("Duel", "You're not the challenged player.", COLORS.error)], ephemeral: true });
    if (Date.now() > duel.expiresAt) { pendingDuels.delete(key); return interaction.update({ embeds: [eb("Duel", "⌛ Duel expired.", COLORS.warn)], components: [] }); }

    if (action === "decline") {
      pendingDuels.delete(key);
      return interaction.update({ embeds: [eb("Duel", `❎ <@${duel.opponentId}> declined the duel against <@${duel.challengerId}>.`, COLORS.warn)], components: [] });
    }
    if (action === "accept") {
      const cBal = getBalance(gid, duel.challengerId);
      const oBal = getBalance(gid, duel.opponentId);
      if (cBal < duel.bet || oBal < duel.bet) {
        pendingDuels.delete(key);
        return interaction.update({ embeds: [eb("Duel", "❌ One player no longer has enough coins. Duel cancelled.", COLORS.error)], components: [] });
      }
      // settle
      addBalance(gid, duel.challengerId, -duel.bet);
      addBalance(gid, duel.opponentId, -duel.bet);
      const winnerId = Math.random() < 0.5 ? duel.challengerId : duel.opponentId;
      const loserId  = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
      const pot = duel.bet * 2;
      addBalance(gid, winnerId, pot);
      pendingDuels.delete(key);

      return interaction.update({
        embeds: [new EmbedBuilder()
          .setTitle("⚔️ Duel Result").setColor(COLORS.game).setTimestamp()
          .addFields(
            { name: "Winner", value: `<@${winnerId}> 🎉 (+${pot})` },
            { name: "Loser",  value: `<@${loserId}> 💸` },
            { name: "Balances", value: `<@${duel.challengerId}>: **${getBalance(gid, duel.challengerId)}**\n<@${duel.opponentId}>: **${getBalance(gid, duel.opponentId)}**` },
          )
        ],
        components: []
      });
    }
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return;
  const gid = interaction.guildId, uid = interaction.user.id;

  // Info
  if (interaction.commandName === "ping")
    return interaction.reply({ embeds: [eb("Ping", "🏓 Pong!", COLORS.info)] });

  if (interaction.commandName === "about")
    return interaction.reply({ embeds: [eb("About This Bot", "I run patrol notifications, mini-games, a server economy (with jobs & admin tools), and more.", COLORS.info)] });

  // RPS
  if (interaction.commandName === "rps") {
    const player = interaction.options.getString("move");
    const choices = ["rock","paper","scissors"];
    const bot = choices[Math.floor(Math.random()*choices.length)];
    const beats = { rock:"scissors", paper:"rock", scissors:"paper" };
    const result = (player === bot) ? "tie" : (beats[player] === bot ? "win" : "lose");
    if (result === "win") rpsAddWin(gid, uid);
    const nice = s => s[0].toUpperCase()+s.slice(1);
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("🎮 Rock • Paper • Scissors").setColor(COLORS.game).setTimestamp()
      .addFields(
        { name: "You", value: `**${nice(player)}**`, inline: true },
        { name: "Bot", value: `**${nice(bot)}**`, inline: true },
        { name: "Result", value: result === "win" ? "✅ You **win**! +1 leaderboard win."
                           : result === "lose" ? "❌ You **lose**!" : "➖ It's a **tie**!" }
      )
    ]});
  }

  if (interaction.commandName === "rpsleaderboard") {
    const top = rpsTop(gid, 10);
    if (top.length === 0) return interaction.reply({ embeds: [eb("RPS Leaderboard", "📊 No wins yet. Play `/rps` to get on the board!", COLORS.game)] });
    const lines = top.map(([id,w], i)=>`**${i+1}.** <@${id}> — **${w}** win${w===1?"":"s"}`).join("\n");
    return interaction.reply({ embeds: [eb("📊 RPS Leaderboard", lines, COLORS.game)] });
  }

  // Economy (user)
  if (interaction.commandName === "balance") {
    const target = interaction.options.getUser("user") || interaction.user;
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("💰 Balance").setColor(COLORS.econ).setTimestamp()
      .addFields({ name: target.username, value: `**${getBalance(gid, target.id)}** coins` })
    ]});
  }

  if (interaction.commandName === "daily") {
    const u = ensureUser(gid, uid);
    const left = DAILY_COOLDOWN_MS - (Date.now() - u.lastDaily);
    if (left > 0) {
      const hrs = Math.floor(left/3600000), mins = Math.floor((left%3600000)/60000);
      return interaction.reply({ embeds: [eb("Daily", `⏳ Already claimed. Try again in **${hrs}h ${mins}m**.`, COLORS.warn)] });
    }
    u.lastDaily = Date.now(); addBalance(gid, uid, DAILY_REWARD);
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("Daily Reward").setColor(COLORS.econ).setTimestamp()
      .addFields(
        { name: "Reward", value: `+**${DAILY_REWARD}**`, inline: true },
        { name: "New Balance", value: `**${getBalance(gid, uid)}**`, inline: true }
      )
    ]});
  }

  if (interaction.commandName === "weekly") {
    const u = ensureUser(gid, uid);
    const left = WEEKLY_COOLDOWN_MS - (Date.now() - u.lastWeekly);
    if (left > 0) {
      const days = Math.floor(left/86400000), hours = Math.floor((left%86400000)/3600000);
      return interaction.reply({ embeds: [eb("Weekly", `⏳ Already claimed. Try again in **${days}d ${hours}h**.`, COLORS.warn)] });
    }
    u.lastWeekly = Date.now(); addBalance(gid, uid, WEEKLY_REWARD);
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("Weekly Reward").setColor(COLORS.econ).setTimestamp()
      .addFields(
        { name: "Reward", value: `+**${WEEKLY_REWARD}**`, inline: true },
        { name: "New Balance", value: `**${getBalance(gid, uid)}**`, inline: true }
      )
    ]});
  }

  if (interaction.commandName === "work") {
    const u = ensureUser(gid, uid);
    const key = getUserJob(gid, uid);
    let minPay = WORK_MIN, maxPay = WORK_MAX, cdMs = WORK_COOLDOWN_MS, jobName = "Unassigned";
    if (key && JOBS[key]) { minPay = JOBS[key].min; maxPay = JOBS[key].max; cdMs = JOBS[key].cooldownMin * 60 * 1000; jobName = JOBS[key].name; }
    const left = cdMs - (Date.now() - u.lastWork);
    if (left > 0) {
      const mins = Math.ceil(left/60000);
      return interaction.reply({ embeds: [eb("Work", `🕐 You're tired. Try again in **${mins}m**.`, COLORS.warn)] });
    }
    const earn = Math.floor(Math.random() * (maxPay - minPay + 1)) + minPay;
    u.lastWork = Date.now(); addBalance(gid, uid, earn);
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("Work Complete").setColor(COLORS.econ).setTimestamp()
      .addFields(
        { name: "Job", value: jobName, inline: true },
        { name: "Earned", value: `**${earn}**`, inline: true },
        { name: "Balance", value: `**${getBalance(gid, uid)}**`, inline: true }
      )
      .setFooter(key && JOBS[key] ? { text: JOBS[key].blurb } : null)
    ]});
  }

  if (interaction.commandName === "give") {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    if (!target || target.bot) return interaction.reply({ embeds: [eb("Give", "❌ Pick a real user (not a bot).", COLORS.error)] });
    if (target.id === uid) return interaction.reply({ embeds: [eb("Give", "❌ You can’t give coins to yourself.", COLORS.error)] });
    if (amount <= 0) return interaction.reply({ embeds: [eb("Give", "❌ Amount must be greater than 0.", COLORS.error)] });

    const bal = getBalance(gid, uid);
    if (bal < amount) return interaction.reply({ embeds: [eb("Give", `❌ Not enough funds. Your balance is **${bal}**.`, COLORS.error)] });

    addBalance(gid, uid, -amount);
    const newTargetBal = addBalance(gid, target.id, amount);

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("Transfer Complete").setColor(COLORS.econ).setTimestamp()
      .addFields(
        { name: "From", value: `<@${uid}>`, inline: true },
        { name: "To", value: `<@${target.id}>`, inline: true },
        { name: "Amount", value: `**${amount}**`, inline: true },
        { name: "Your Balance", value: `**${getBalance(gid, uid)}**`, inline: true },
        { name: `${target.username}'s Balance`, value: `**${newTargetBal}**`, inline: true },
      )
    ]});
  }

  if (interaction.commandName === "richest") {
    const g = eco[gid] || {};
    const rows = Object.entries(g);
    if (!rows.length) return interaction.reply({ embeds: [eb("Rich List", "🏦 No accounts yet. Use `/work` or `/daily` to get started!", COLORS.econ)] });
    const top = rows.sort((a,b) => (b[1].balance||0)-(a[1].balance||0)).slice(0,10);
    const lines = top.map(([id, data], i)=>`**${i+1}.** <@${id}> — **${data.balance||0}**`).join("\n");
    return interaction.reply({ embeds: [eb("🏦 Server Rich List", lines, COLORS.econ)] });
  }

  // Jobs
  if (interaction.commandName === "setjob") {
    const key = interaction.options.getString("job");
    if (!JOBS[key]) return interaction.reply({ embeds: [eb("Jobs", "❌ Invalid job.", COLORS.error)] });
    setUserJob(gid, uid, key);
    const j = JOBS[key];
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("Job Updated").setColor(COLORS.econ).setTimestamp()
      .addFields(
        { name: "Job", value: `**${j.name}**`, inline: true },
        { name: "Pay", value: `**${j.min}-${j.max}**`, inline: true },
        { name: "Cooldown", value: `**${j.cooldownMin}m**`, inline: true }
      )
      .setFooter({ text: j.blurb })
    ]});
  }

  if (interaction.commandName === "job") {
    const key = getUserJob(gid, uid);
    if (!key) return interaction.reply({ embeds: [eb("Your Job", "🧰 You don't have a job yet. Use **/setjob** to pick one.", COLORS.info)] });
    const j = JOBS[key];
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("Your Job").setColor(COLORS.econ).setTimestamp()
      .addFields(
        { name: "Job", value: `**${j.name}**`, inline: true },
        { name: "Pay", value: `**${j.min}-${j.max}**`, inline: true },
        { name: "Cooldown", value: `**${j.cooldownMin}m**`, inline: true }
      )
      .setFooter({ text: j.blurb })
    ]});
  }

  if (interaction.commandName === "jobslist") {
    const fields = Object.values(JOBS).map(j => ({ name: j.name, value: `Pay: **${j.min}-${j.max}** • Cooldown: **${j.cooldownMin}m**\n_${j.blurb}_` }));
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("📋 Available Jobs").setColor(COLORS.econ).addFields(fields).setTimestamp()] });
  }

  // Games
  if (interaction.commandName === "slots") {
    const bet = interaction.options.getInteger("bet");
    const bal = getBalance(gid, uid);
    if (bal < bet) return interaction.reply({ embeds: [eb("Slots", `❌ You don't have enough coins. Balance: **${bal}**.`, COLORS.error)] });

    addBalance(gid, uid, -bet);
    const { reels, mul, label } = spinSlots();
    const payout = bet * mul; if (payout > 0) addBalance(gid, uid, payout);
    const net = payout - bet, sign = net >= 0 ? "+" : "−";
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("🎰 Slots").setColor(COLORS.game).setTimestamp()
      .addFields(
        { name: "Spin", value: `\`${reels.join(" │ ")}\`` },
        { name: "Result", value: label },
        { name: "Bet", value: `**${bet}**`, inline: true },
        { name: "Net", value: `**${sign}${Math.abs(net)}**`, inline: true },
        { name: "Balance", value: `**${getBalance(gid, uid)}**`, inline: true }
      )
    ]});
  }

  if (interaction.commandName === "duel") {
    const opponent = interaction.options.getUser("opponent");
    const bet = interaction.options.getInteger("bet");
    if (!opponent || opponent.bot) return interaction.reply({ embeds: [eb("Duel", "❌ Pick a real user (not a bot).", COLORS.error)] });
    if (opponent.id === uid) return interaction.reply({ embeds: [eb("Duel", "❌ You can't duel yourself.", COLORS.error)] });

    const cBal = getBalance(gid, uid), oBal = getBalance(gid, opponent.id);
    if (cBal < bet) return interaction.reply({ embeds: [eb("Duel", `❌ You don't have **${bet}** coins. Balance: **${cBal}**.`, COLORS.error)] });
    if (oBal < bet) return interaction.reply({ embeds: [eb("Duel", `❌ ${opponent.username} doesn't have enough coins to accept this duel.`, COLORS.error)] });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("duel_accept").setLabel("Accept").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("duel_decline").setLabel("Decline").setStyle(ButtonStyle.Danger)
    );

    const emb = new EmbedBuilder()
      .setTitle("⚔️ Duel Challenge").setColor(COLORS.game).setTimestamp()
      .addFields(
        { name: "Challenger", value: `<@${uid}>`, inline: true },
        { name: "Opponent", value: `<@${opponent.id}>`, inline: true },
        { name: "Bet", value: `**${bet}**`, inline: true },
        { name: "Timer", value: "You have **60s** to accept." }
      );

    const msg = await interaction.reply({ embeds: [emb], components: [row], fetchReply: true });
    pendingDuels.set(`${gid}:${msg.id}`, { challengerId: uid, opponentId: opponent.id, bet, expiresAt: Date.now() + DUEL_TIMEOUT_MS });

    setTimeout(() => {
      const key = `${gid}:${msg.id}`;
      if (!pendingDuels.has(key)) return;
      pendingDuels.delete(key);
      msg.edit({ embeds: [eb("Duel", "⌛ Duel expired.", COLORS.warn)], components: [] }).catch(()=>{});
    }, DUEL_TIMEOUT_MS);
    return;
  }

  // Admin
  if (interaction.commandName === "ecoadd") {
    if (!isAdmin(interaction)) return interaction.reply({ embeds: [eb("Admin", "❌ Admins only.", COLORS.error)] });
    const target = interaction.options.getUser("user"); const amount = interaction.options.getInteger("amount");
    const newBal = addBalance(gid, target.id, amount);
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("Admin • ecoadd").setColor(COLORS.econ).setTimestamp()
      .addFields(
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Added", value: `**${amount}**`, inline: true },
        { name: "New Balance", value: `**${newBal}**`, inline: true }
      )
    ]});
  }

  if (interaction.commandName === "ecoset") {
    if (!isAdmin(interaction)) return interaction.reply({ embeds: [eb("Admin", "❌ Admins only.", COLORS.error)] });
    const target = interaction.options.getUser("user"); const amount = interaction.options.getInteger("amount");
    const newBal = setBalance(gid, target.id, amount);
    return interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle("Admin • ecoset").setColor(COLORS.econ).setTimestamp()
      .addFields(
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Set To", value: `**${newBal}**`, inline: true }
      )
    ]});
  }

  if (interaction.commandName === "ecoreset") {
    if (!isAdmin(interaction)) return interaction.reply({ embeds: [eb("Admin", "❌ Admins only.", COLORS.error)] });
    const scope = interaction.options.getString("scope");
    const target = interaction.options.getUser("user");
    if (scope === "server") { resetServer(gid); return interaction.reply({ embeds: [eb("Admin • ecoreset", "♻️ Server economy reset.", COLORS.warn)] }); }
    if (scope === "user" && target) { resetUser(gid, target.id); return interaction.reply({ embeds: [eb("Admin • ecoreset", `♻️ Reset <@${target.id}>'s account.`, COLORS.warn)] }); }
    return interaction.reply({ embeds: [eb("Admin • ecoreset", "❌ For `scope=user`, you must select a user.", COLORS.error)] });
  }
});
// ===================== END SLASH COMMANDS =====================

client.login(process.env.DISCORD_TOKEN);
