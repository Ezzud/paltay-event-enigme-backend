require("dotenv").config();
const express = require('express');
const { QuickDB } = require('quick.db');
const quickdb = new QuickDB();
const bodyParser = require('body-parser');
const db = quickdb.table('event_stats');
const logger = require('./api/logger');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const port = 4884;
const STEP_COUNT = 10;

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent
	]
});

async function createDataEntry(data) {
	const dataToken = await generateDataToken();
	const giftCode = await generateGiftCode();
	data.completed = false;
	data.giftCode = giftCode;
	await setUserData(dataToken, data);
	logger.success(`POST /auth/login/ - Created data entry for user ${data.username} (${data.userId})`);
	await sendStartLogs(data);
	return dataToken;
}

async function generateGiftCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    const codeLength = 16;

    for (let i = 0; i < codeLength; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        code += characters[randomIndex];
        if ((i + 1) % 4 === 0 && i !== codeLength - 1) {
            code += '-';
        }
    }
    return code;
}

async function generateDataToken() {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let token = '';
	const tokenLength = 16;

	for (let i = 0; i < tokenLength; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		token += characters[randomIndex];
	}
	return token;
}

async function getUserCount() {
	const allData = await db.all();
	return allData.length;
}

async function getUserStep(dataToken) {
	const userData = await getUserData(dataToken);
	return userData.step;
}

async function getUserDataByUserId(userId) {
	const allData = await db.all();
	const userData = allData.find((data) => data.value.userId === userId);
	return userData ? userData.value : undefined;
}

async function getDataTokenByUserId(userId) {
	const allData = await db.all();
	const userData = allData.find((data) => data.value.userId === userId);
	logger.info(`GET /users/ - Fetched data entry for user ${userData.value.username} (${userData.value.userId})`);
	return userData.id;
}

async function setUserStep(dataToken, step) {
	const userData = await getUserData(dataToken);
	userData.step = step;
	await db.set(dataToken, userData);
}

async function getGlobalStats() {
    const allData = await db.all();
    const completed = allData.filter((data) => data.value.completed === true).length;
    const total = allData.length;

    const steps = {};
    for (let i = 0; i < allData.length; i++) {
        const step = allData[i].value.step;
        if (steps[step]) {
            steps[step]++;
        } else {
            steps[step] = 1;
        }
    }

    const stepsArray = [];
    for (const step in steps) {
        if (steps.hasOwnProperty(step)) {
            stepsArray.push({ step: step, count: steps[step] });
        }
    }

    return { completed: completed, total: total, steps: stepsArray };
}


async function passStep(dataToken) {
	
	const step = await getUserStep(dataToken);
	const userData = await getUserData(dataToken);
	if(step >= STEP_COUNT) {
		userData.completed = true;
		await setUserData(dataToken, userData);
		await giveUserRole(userData);
		sendEndLogs(userData);
		return true;
	}
	if(userData)
		await sendStepPassLogs(userData, step + 1);
	await setUserStep(dataToken, step + 1);
	return (step + 1) === await getUserStep(dataToken);
}

async function giveUserRole(userData) {
	let guild = client.guilds.cache.get(process.env.GUILD_ID);
	if(!guild) return;
	let member = await guild.members.fetch(userData.userId).catch(err => { logger.error(err);});
	if(!member) return;
	let role = await guild.roles.fetch(process.env.WINNER_ROLE_ID).catch(err => { logger.error(err);});
	if(!role) return;
	await member.roles.add(role).catch(err => { logger.error(err);});
	logger.success(`POST /nextstep/ - Gave role to user ${userData.username} (${userData.userId})`);
	logger.warning(`POST /nextstep/ - User ${userData.username} (${userData.userId}) has completed the event`);
}

async function setUserData(dataToken, data) {
	await db.set(dataToken, data);
}

async function getUserData(dataToken) {
	const userData = await db.get(dataToken);
	return userData;
}

async function tokenValid(dataToken) {
	const userData = await getUserData(dataToken);
	return userData !== null && userData !== undefined;
}

async function sendStartLogs(user) {
	let guild = client.guilds.cache.get(process.env.GUILD_ID);
	if(!guild) return;
	let channel = guild.channels.cache.get(process.env.LOGS_CHANNEL_ID);
	if(!channel) return;
	let userCount = await getUserCount();
	await channel.send(`:door: <@${user.userId}> (${user.username}) vient de commencer l'énigme **(${userCount} participant${userCount > 1 ? "s" : ""} au total)**`);
}

async function sendStepPassLogs(user, step) {
	let guild = client.guilds.cache.get(process.env.GUILD_ID);
	if(!guild) return;
	let channel = guild.channels.cache.get(process.env.LOGS_CHANNEL_ID);
	if(!channel) return;
	let { steps } = await getGlobalStats();
	let stepCount = steps.find((s) => s.step == step) || 0;
	if(!stepCount) stepCount = 0;
	await channel.send(`:rocket: <@${user.userId}> (${user.username}) est passé à l'étape \` ${step} \`  ${stepCount ? `*(${stepCount.count+1} participant${stepCount.count > 1 ? "s" : ""} à cette étape)*` : ""}`);
}

async function sendEndLogs(user) {
	let guild = client.guilds.cache.get(process.env.GUILD_ID);
	if(!guild) return;
	let channel = guild.channels.cache.get(process.env.LOGS_CHANNEL_ID);
	if(!channel) return;
	let { completed } = await getGlobalStats();
	let classement = completed === 1 ? "1er" : `${completed}ème`;
	await channel.send(`### 🏆 <@${user.userId}> (${user.username}) vient de terminer toute les étapes en étant **${classement}** ||${user.giftCode}||`);
}

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
	res.send('Comment tu sais?');
	return;
});

app.get('/auth/verify/:token', async (req, res) => {
	const dataToken = req.params.token;
	const isValid = await tokenValid(dataToken);
	res.send({ isValid: isValid });
	return;
});

app.get('/users/:dataToken', async (req, res) => {
	const dataToken = req.params.dataToken;
	const userData = await getUserData(dataToken);
	res.send({ userData: userData });
	return;
});

app.post('/nextstep/:dataToken', async (req, res) => {
	const dataToken = req.params.dataToken;
	if(!await tokenValid(dataToken)) {
		res.send({ success: false }).catch(err => { logger.error(err);});
		return;
	}
	let result = await passStep(dataToken);
	res.send({ success : result });

	let userInfo = await getUserData(dataToken);
	if(result) {
		logger.success(`POST /nextstep/ - User ${userInfo.username} (${userInfo.userId}) passed step ${userInfo.step}`);
	} else {
		logger.error(`POST /nextstep/ - User ${userInfo.username} (${userInfo.userId}) failed to pass step ${userInfo.step}`);
	}
	return;
});

app.get('/stats', async (req, res) => {
	const stats = await getGlobalStats();
	res.send(stats);
	return;
});

app.get('/stats/:userid', async (req, res) => {
	const userId = req.params.userid;
	const userData = await getUserDataByUserId(userId);
	res.send(userData);
	return;
});

app.post('/auth/login', async (req, res) => {
	const data = req.body;

	let format = "jpg";
	if (data.avatar && data.avatar.startsWith("a_")) {
		format = "gif";
	}

	const avatarURL = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${format}`;
	const validData = {
		userId: data.id,
		step: 1,
		username: data.username,
		avatarURL: avatarURL,
	}
	if(await getUserDataByUserId(data.id)) {
		const dataToken = await getDataTokenByUserId(data.id);
		return res.send({ token: dataToken });
	} else {
		const dataToken = await createDataEntry(validData);
		return res.send({ token: dataToken });
	}
});


logger.displaySplash();
app.listen(port, () => {
	logger.info(`Server listening at ${port}`);
});

client.on('ready', () => {
	logger.info(`Logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);
