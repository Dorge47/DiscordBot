require('dotenv').config();
const Discord = require('discord.js');
const fs = require('fs');
const youtube = require('./screwyYouTubeAPI.js');// https://github.com/Dorge47/YouTubeAPI
var fileCache = {};
fileCache['streamers'] = [];
fileCache['streams'] = [];
const client = new Discord.Client({intents: ["GUILDS", "GUILD_MESSAGES"]});

function loadFileCache() {
    fileCache['streamers'] = JSON.parse(fs.readFileSync('streamers.json'));
    fileCache['streams'] = JSON.parse(fs.readFileSync('streams.json'));
}

loadFileCache();

//Discord stuff

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async msg => {
    switch (msg.content) {
        case 'test':
            msg.reply('I\'m working!');
            break;
        case 'logout':
            await msg.reply('Confirmed logout.');
            client.destroy();
            break;
        case 'log':
            console.log(msg);
            break;
        default:
            break;
    };
});

client.login(process.env.CLIENT_TOKEN);
