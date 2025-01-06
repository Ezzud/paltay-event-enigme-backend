require("dotenv").config();
const express = require('express');
const { QuickDB } = require('quick.db');
const quickdb = new QuickDB();
const bodyParser = require('body-parser');
const app = express();
const port = 4884;
const db = quickdb.table('event_stats');
const logger = require('./api/logger');
const { Client, GatewayIntentBits } = require('discord.js');
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

async function passStep(dataToken) {
	const STEP_COUNT = 10;

	const step = await getUserStep(dataToken);
	const userData = await getUserData(dataToken);
	if(step >= STEP_COUNT) {
		userData.completed = true;
		await setUserData(dataToken, userData);
		sendEndLogs(userData);
		return true;
	}
	if(userData)
		await sendStepPassLogs(userData, step + 1);
	await setUserStep(dataToken, step + 1);
	return (step + 1) === await getUserStep(dataToken);
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
	await channel.send(`:door: <@${user.userId}> (${user.username}) vient de commencer l'énigme **(${userCount} participants)**`);
}

async function sendStepPassLogs(user, step) {
	let guild = client.guilds.cache.get(process.env.GUILD_ID);
	if(!guild) return;
	let channel = guild.channels.cache.get(process.env.LOGS_CHANNEL_ID);
	if(!channel) return;
	await channel.send(`:rocket: <@${user.userId}> (${user.username}) est passé à l'étape \` ${step} \``);
}

async function sendEndLogs(user) {
	let guild = client.guilds.cache.get(process.env.GUILD_ID);
	if(!guild) return;
	let channel = guild.channels.cache.get(process.env.LOGS_CHANNEL_ID);
	if(!channel) return;
	await channel.send(`🏆 <@${user.userId}> (${user.username}) vient de terminer toute les étapes`);
}

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
	res.send('Hello World!');
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
});

app.post('/nextstep/:dataToken', async (req, res) => {
	const dataToken = req.params.dataToken;
	if(!await tokenValid(dataToken)) {
		res.send({ success: false });
		return;
	}
	let result = await passStep(dataToken);
	res.send({ success : result });

	let userInfo = await getUserData(dataToken);
	if(result) {
		logger.success(`STEP - User ${userInfo.username} (${userInfo.userId}) passed step ${userInfo.step}`);
	} else {
		logger.error(`STEP - User ${userInfo.username} (${userInfo.userId}) failed to pass step ${userInfo.step}`);
	}
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
