require('dotenv').config();
const Discord = require('discord.js');
const fs = require('fs');
const youtube = require('./../YouTubeAPI/screwyYouTubeAPI.js');// https://github.com/Dorge47/YouTubeAPI
var fileCache = {};
fileCache['streamers'] = [];
fileCache['streams'] = [];
const client = new Discord.Client({intents: ["GUILDS", "GUILD_MESSAGES"]});
var timeoutsActive = [];
var currentLoopTimeout;
var announcementTimeouts = [];
var initLoop = true;

function loadFileCache() {
    fileCache['streamers'] = JSON.parse(fs.readFileSync('streamers.json'));
    fileCache['streams'] = JSON.parse(fs.readFileSync('streams.json'));
};

function writeStreams() {
    fs.writeFileSync('streams.json', JSON.stringify(fileCache['streams']));
};

function clearTimeoutsManually(identifier, method) {
    switch (method) {
        case "streamId":
            for (let i = announcementTimeouts.length - 1; i >= 0; i--) {
                if (announcementTimeouts[i][1] == identifier) {
                    clearTimeout(announcementTimeouts[i][0]);
                    timeoutsActive = timeoutsActive.filter(timeout => timeout != announcementTimeouts[i][0]);
                    announcementTimeouts.splice(i,1);
                };
            };
            break;
        default:
            console.error("clearTimeoutsManually() called with unknown method: " + method);
            break;
    };
    console.log("Timeout with " + method + ": " + identifier + " cleared successfully");
};

function getInfoFromChannelId(channelId) {
    for (let i = 0; i < fileCache['streamers'].length; i++) {
        if (fileCache['streamers'][i].id == channelId) {
            return fileCache['streamers'][i];
        };
    };
    console.error("fileCache['streamers'] contains no entry with id: " + channelId);
};

function getAppropriateGuildChannel(org) {
    switch (org) {
        case 0:
            return process.env.INDIE_ID;
        case 1:
            return process.env.H_JP_ID;
        case 2:
            return process.env.H_ID_ID;
        case 3:
            return process.env.H_EN_ID;
        case 4:
            return process.env.N_JP_ID;
        case 5:
            return process.env.N_EN_ID;
        case 6:
            return process.env.VOMS_ID;
    };
};

function livestreamLoop(currentId) {
    timeoutsActive = timeoutsActive.filter(timeout => timeout != currentLoopTimeout); // Remove currentLoopTimeout from timeoutsActive
    processUpcomingStreams(fileCache['streamers'][currentId].id);
    var nextId = (currentId == fileCache['streamers'].length - 1) ? 0 : (currentId + 1);
    if (initLoop && !nextId) {
        console.log("Finished sweep, relaxing");
        initLoop = false;
    };
    currentLoopTimeout = setTimeout(livestreamLoop, initLoop ? 5000 : 10000, nextId);
    timeoutsActive.push(currentLoopTimeout);
};

async function processUpcomingStreams(channelId) {
    let streamData = await youtube.getFutureVids(channelId);
    for (let i = 0; i < streamData.length; i++) {
        if (streamData[i].status == "live") {
            continue;
        };
        let streamProcessed = false;
        let streamDate = JSON.stringify(streamData[i].available_at);
        for (let j = fileCache['streams'].length - 1; j >= 0; j--) {
            if (fileCache['streams'][j].id == streamData[i].id) {
                streamProcessed = true;
                if (fileCache['streams'][j].available_at != streamDate) {
                    clearTimeoutsManually(streamData[i].id, "streamId");
                    let timeUntilStream = new Date(streamDate) - new Date();
                    if (timeUntilStream < -300000) {
                        console.error("Stream with ID: " + streamData[i].id + " already started, skipping announcement");
                        fileCache['streams'].splice(j,1);
                    }
                    else {
                        let announceTimeout = setTimeout(announceStream, timeUntilStream, streamData[i].id, channelId);
                        let debugMsg = "Rectified timer for announcement of " + streamData[i].id + ", " + timeUntilStream + " milliseconds remaining";
                        console.log(debugMsg);
                        timeoutsActive.push(announceTimeout);
                        announcementTimeouts.push([announceTimeout, streamData[i].id]);
                        fileCache['streams'][j] = streamData[i];
                    };
                };
                break;
            };
        };
        if (!streamProcessed) {
            let timeUntilStream = new Date(streamDate) - new Date();
            let announceTimeout = setTimeout(announceStream, timeUntilStream, streamData[i].id, channelId);
            let debugMsg = "Set timer for announcement of " + streamData[i].id + ", " + timeUntilStream + " milliseconds remaining";
            console.log(debugMsg);
            timeoutsActive.push(announceTimeout);
            announcementTimeouts.push([announceTimeout, streamData[i].id]);
            fileCache['streams'].push(streamData[i]);
        };
    };
    writeStreams();
};

async function announceStream(streamId, channelId) {
    let streamData = await youtube.getVideoById(streamId);
    let streamDate = JSON.stringify(streamData.available_at);
    if (typeof(streamData.id) == "undefined") {
        console.error("StreamId: " + streamId + ", channelId: " + channelId + ", raw JSON: " + JSON.stringify(streamData));
        process.exit();
    };
    let cacheIndex;
    let cacheData;
    let streamerInfo = getInfoFromChannelId(channelId);
    for (let i = 0; i < fileCache['streams'].length; i++) {
        if (fileCache['streams'][i].id == streamId) {
            cacheIndex = i;
            cacheData = fileCache['streams'][i];
            break;
        };
    };
    if (streamData.status == "missing") {
        console.error(streamerInfo.shortName + " cancelled stream with ID: " + streamId + ", skipping announcement");
    }
    else {
        if (streamDate != cacheData.available_at) { // Stream has already started or been rescheduled, or we're waiting for the host
            let timeUntilStream = new Date(streamDate) - new Date();
            if (timeUntilStream < -300000 && streamDate != undefined) { // Stream has already started over five minutes ago
                console.error("Stream with ID: " + streamData.id + " started " + (timeUntilStream * -1) + " milliseconds ago, skipping announcement");
                console.error("Start time: " + streamDate);
            }
            else if (timeUntilStream > 60000) { // Stream has been rescheduled for at least a minute from now
                clearTimeoutsManually(streamData.id, "streamId");
                let announceTimeout = setTimeout(announceStream, timeUntilStream, streamData.id, channelId);
                let debugMsg = "Rectified timer for announcement of " + streamData.id + ", " + timeUntilStream + " milliseconds remaining";
                console.log(debugMsg);
                timeoutsActive.push(announceTimeout);
                announcementTimeouts.push([announceTimeout, streamData.id]);
                fileCache['streams'][cacheIndex] = streamData;
                return;
            }
            else if (streamData.status == "live" && streamDate != undefined) { // Stream start time has changed, but is live now
                let guildChannelId = getAppropriateGuildChannel(streamerInfo.org)
                await fireAnnouncement(streamerInfo.shortName, streamId, guildChannelId);
            }
            else { // Recheck for live in 20 seconds
                clearTimeoutsManually(streamData.id, "streamId");
                let announceTimeout = setTimeout(announceStream, 20000, streamData.id, channelId);
                let debugMsg = "Delaying announcement of " + streamData.id + " for 20 seconds";
                console.log(debugMsg);
                timeoutsActive.push(announceTimeout);
                announcementTimeouts.push([announceTimeout, streamData.id]);
                fileCache['streams'][cacheIndex] = streamData;
                return;
            }
        }
        else if (streamData.status == "live") { // Stream start time unchanged and live
            let guildChannelId = getAppropriateGuildChannel(streamerInfo.org)
            await fireAnnouncement(streamerInfo.shortName, streamId, guildChannelId);
        }
        else {
            let timeUntilStream = new Date(streamDate) - new Date();
            if (timeUntilStream > 360000000) {// Sometimes waiting rooms get rescheduled while in our system and fly under the radar to this point
                console.error("Stream with ID: " + streamData.id + " is over 100 hours in the future, ignoring");
            }
            else {// Recheck for live in 20 seconds
                clearTimeoutsManually(streamData.id, "streamId");
                let announceTimeout = setTimeout(announceStream, 20000, streamData.id, channelId);
                let debugMsg = "Delaying announcement of " + streamData.id + " for 20 seconds";
                console.log(debugMsg);
                timeoutsActive.push(announceTimeout);
                announcementTimeouts.push([announceTimeout, streamData.id]);
                fileCache['streams'][cacheIndex] = streamData;
                return;
            }
        }
    }
    clearTimeoutsManually(streamId, "streamId");
    fileCache['streams'].splice(cacheIndex, 1);
    /* This is where we would typically call writeStreams(), but it's not
    uncommon for multiple streams to be announced at the exact same time, so we
    have to leave the streams.json file out of date. Invoking the prune function
    is a way to manually update the file */
}

async function fireAnnouncement(shortName = "Vtuber", videoId = "dQw4w9WgXcQ", guildChannelId = process.env.H_JP_ID) {// Verification should be done BEFORE this is called
    var preAnnounce = (shortName + " is live!");
    var announce = "https://youtu.be/" + videoId;
    await client.channels.cache.get(guildChannelId).send(preAnnounce);
    await client.channels.cache.get(guildChannelId).send(announce);
    return;
};

// Discord stuff

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async msg => {
    if (msg.author.id != process.env.ADMIN_ID) {
        return;
    };
    switch (msg.content.toLowerCase()) {
        case 'test':
            msg.reply('I\'m working!');
            break;
        case 'logout':
            for (let i = timeoutsActive.length - 1; i >= 0 ; i--) {
                clearTimeout(timeoutsActive[i]);
            };
            writeStreams;
            await msg.reply('Confirmed logout.');
            client.destroy();
            break;
        case 'log':
            console.log(msg);
            await msg.reply('Confirmed log.');
            break;
        case 'refresh':
            loadFileCache();
            await msg.reply('Confirmed refresh of file cache.');
            break;
        default:
            break;
    };
});

client.login(process.env.CLIENT_TOKEN);// No Discord stuff past this point

// Final initializations

loadFileCache();
setTimeout(function() {
    for (let i = fileCache['streams'].length - 1; i >= 0; i--) {
        let timeUntilStream = new Date(fileCache['streams'][i].available_at) - new Date();
        if (timeUntilStream > 360000000) {
            console.error("Stream with ID: " + streamData.id + " is over 100 hours in the future, ignoring");
            fileCache['streams'].splice(i, 1);
        }
        else if (timeUntilStream > 0) {
            let announceTimeout = setTimeout(announceStream, timeUntilStream, fileCache['streams'][i].id, fileCache['streams'][i].channel.id);
            let debugMsg = "Set timer for announcement of " + fileCache['streams'][i].id + ", " + timeUntilStream + " milliseconds remaining";
            console.log(debugMsg);
            timeoutsActive.push(announceTimeout);
            announcementTimeouts.push([announceTimeout, fileCache['streams'][i].id]);
        }
        else if (fileCache['streams'][i].available_at == undefined) {
            fileCache['streams'].splice(i,1);
        }
        else {
            fileCache['streams'].splice(i,1);
        }
    }
}, 5000);
writeStreams();
currentLoopTimeout = setTimeout(livestreamLoop, 15000, 0);
timeoutsActive.push(currentLoopTimeout);