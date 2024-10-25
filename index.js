#!/usr/bin/env node
require('dotenv').config();
const Discord = require('discord.js');
const fs = require('fs');
const mariadb = require('mariadb');
const youtubeScraper = require('./../YouTubeAPI/screwyYouTubeAPI.js');// https://github.com/Dorge47/YouTubeAPI
const twitch = require('./../TwitchAPI/screwyTwitchAPI.js');// https://github.com/Dorge47/TwitchAPI
const holodex = require('./../HolodexAPI/screwyHolodexAPI.js');// https://github.com/Dorge47/HolodexAPI
const twitchAPIKey = JSON.parse(fs.readFileSync("twitchapikey.json"));
var fileCache = {};
fileCache['ytStreamers'] = [];
fileCache['twitchStreamers'] = [];
fileCache['ytStreams'] = {};
fileCache['twitchStreams'] = [];
const client = new Discord.Client({intents: ["GUILDS", "GUILD_MESSAGES"]});
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    connectionLimit: 5,
    database: process.env.DB_NAME
});
var timeoutsActive = [];
var currentYtLoopTimeout;
var currentTwitchLoopTimeout;
var currentMidnightTimeout;
var announcementTimeouts = [];
var initLoop = true;

function loadFileCache() {
    fileCache['ytStreamers'] = JSON.parse(fs.readFileSync('YouTubeStreamers.json'));
    fileCache['ytStreams'] = JSON.parse(fs.readFileSync('ytStreams.json'));
    fileCache['twitchStreamers'] = JSON.parse(fs.readFileSync('TwitchStreamers.json'));
    fileCache['twitchStreams'] = JSON.parse(fs.readFileSync('twitchStreams.json'));
};

function writeStreams() {
    fs.writeFileSync('ytStreams.json', JSON.stringify(fileCache['ytStreams']));
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

function getInfoFromYtChannelId(channelId) {
    for (let i = 0; i < fileCache['ytStreamers'].length; i++) {
        if (fileCache['ytStreamers'][i].id == channelId) {
            return fileCache['ytStreamers'][i];
        };
    };
    console.error("fileCache['ytStreamers'] contains no entry with id: " + channelId);
};

function getInfoFromTwitchChannelId(channelId) {
    for (let i = 0; i < fileCache['twitchStreamers'].length; i++) {
        if (fileCache['twitchStreamers'][i].id == channelId) {
            return fileCache['twitchStreamers'][i];
        };
    };
    console.error("fileCache['twitchStreamers'] contains no entry with id: " + channelId);
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
        case 7:
            return process.env.VSHOJO_ID;
        case 8:
            return process.env.HS_ID;
        case 9:
            return process.env.HS_EN_ID;
        case 10:
            return process.env.IL_EN_ID;
        case 11:
            return process.env.PC_ID;
        case 12:
            return process.env.V4M_ID;
        case 13:
            return process.env.IL_ES_ID;
    };
};

async function startupPurge() {
    for (let streamId in fileCache['ytStreams']) {
        let stream = fileCache['ytStreams'][streamId];
        let timeUntilStream = new Date(stream.available_at) - new Date();
        if (timeUntilStream > 360000000) { // future
            console.error("Stream with ID: " + streamId + " is over 100 hours in the future, ignoring");
            delete fileCache['ytStreams'][streamId];
        }
        else if (timeUntilStream > 0) { // upcoming
            let announceTimeout = setTimeout(announceStream, timeUntilStream, streamId, stream.channel.id);
            let debugMsg = "Set timer for announcement of " + streamId + ", " + timeUntilStream + " milliseconds remaining";
            console.log(debugMsg);
            timeoutsActive.push(announceTimeout);
            announcementTimeouts.push([announceTimeout, streamId]);
        }
        else if (stream.available_at == undefined) {
            delete fileCache['ytStreams'][streamId];
        }
        else { // rescheduled
            let streamData = await youtubeScraper.getVideoById(streamId);
            incrementQuota();
            let timeUntilStream = new Date(streamData.available_at) - new Date();
            if (streamData.status == "past" || streamData.status == "missing") {
                delete fileCache['ytStreams'][streamId];
            }
            else if (timeUntilStream < -3600000) { // too late
                delete fileCache['ytStreams'][streamId];
            }
            else {
                let announceTimeout = setTimeout(announceStream, timeUntilStream, streamId, stream.channel.id);
                let debugMsg = "Set timer for announcement of " + streamId + ", " + timeUntilStream + " milliseconds remaining";
                console.log(debugMsg);
                timeoutsActive.push(announceTimeout);
                announcementTimeouts.push([announceTimeout, streamId]);
            };
        };
    };
    console.log("Cache purged");
};

function twitchLoop(currentId) {
    timeoutsActive = timeoutsActive.filter(timeout => timeout != currentTwitchLoopTimeout); // Remove currentTwitchLoopTimeout from timeoutsActive
    processTwitchChannel(fileCache['twitchStreamers'][currentId].id);
    var nextId = (currentId == fileCache['twitchStreamers'].length - 1) ? 0 : (currentId + 1);
    let twitchInterval = Math.floor(20000/(fileCache['twitchStreamers'].length));
    currentTwitchLoopTimeout = setTimeout(twitchLoop, twitchInterval, nextId);
    timeoutsActive.push(currentTwitchLoopTimeout);
};

function twitchStartup() {
    let twitchInterval = Math.floor(20000/(fileCache['twitchStreamers'].length)); // Ensure that it never takes longer than 20000ms to notice a stream
    currentTwitchLoopTimeout = setTimeout(twitchLoop, twitchInterval, 0);
    timeoutsActive.push(currentTwitchLoopTimeout);
};

function livestreamLoop(currentId) {
    timeoutsActive = timeoutsActive.filter(timeout => timeout != currentYtLoopTimeout); // Remove currentYtLoopTimeout from timeoutsActive
    processUpcomingStreams(fileCache['ytStreamers'][currentId].id);
    var nextId = (currentId == fileCache['ytStreamers'].length - 1) ? 0 : (currentId + 1);
    if (initLoop && !nextId) {
        console.log("Finished sweep, relaxing");
        initLoop = false;
    };
    currentYtLoopTimeout = setTimeout(livestreamLoop, initLoop ? 5000 : 10000, nextId);
    timeoutsActive.push(currentYtLoopTimeout);
};

function incrementQuota() {
    rawQuery('UPDATE quota SET quotaValue = quotaValue + 1 WHERE platform = "live";');
};

async function quotaDebug() {
    timeoutsActive = timeoutsActive.filter(timeout => timeout != currentMidnightTimeout); // Remove currentMidnightTimeout from timeoutsActive
    var quota = await rawQuery('SELECT * FROM quota WHERE platform = "live";');
    await client.channels.cache.get(process.env.BOT_CH_ID).send("Quota usage is " + quota[0].quotaValue + ".");
    rawQuery('UPDATE quota SET quotaValue = 0 WHERE platform = "live";');
    let currentTime = new Date();
    let nextMidnight = new Date(currentTime.getFullYear(),currentTime.getMonth(),currentTime.getDate()+1);
    let timeToMidnight = (nextMidnight - currentTime);
    currentMidnightTimeout = setTimeout(quotaDebug, timeToMidnight);
    timeoutsActive.push(currentMidnightTimeout);
};

async function rawQuery(queryString, queryParams = null) {
    let conn;
    let rows;
    try {
        conn = await pool.getConnection();
        if (queryParams == null) {
            rows = await conn.query(queryString);
        }
        else {
            rows = await conn.query(queryString, queryParams);
        }
    } catch (err) {
        throw err;
    } finally {
        if (conn) await conn.end();
        return rows;
    }
};

async function processUpcomingStreams(channelId) {
    //let functionStart = new Date();
    let streamData = await youtubeScraper.getFutureVids(channelId);
    rawQuery('UPDATE quota SET quotaValue = quotaValue + ? WHERE platform = "live";', [streamData[1]]);
    streamData = streamData[0];
    let holodexDown = false;
    let holodexData = [];
    try {
        holodexData = await holodex.getFutureVids(channelId, process.env.HOLODEX_KEY);
    }
    catch(err) {
        holodexDown = true;
    };
    if (!holodexDown) {
        for (let i = 0; i < holodexData.length; i++) {
            let streamNoticed = false;
            for (let j = 0; j < streamData.length; j++) {
                if (streamData[j].id == holodexData[i].id) {
                    streamNoticed = true;
                    break;
                };
            };
            if (!streamNoticed) {
                // Check if Holodex is giving us a channel ID we don't have an org assigned to (it's happened with 2nd channels)
                let badChannelId = true;
                for (let j = 0; j < fileCache['ytStreamers'].length; j++) {
                    if (holodexData[i].channel_id == fileCache['ytStreamers'][j].id) {
                        badChannelId = false;
                        break;
                    };
                };
                if (!badChannelId) {
                    let streamToPush = await youtubeScraper.getVideoById(holodexData[i].id);
                    incrementQuota();
                    streamData.push(streamToPush);
                };
            };
        };
    };
    for (let i = 0; i < streamData.length; i++) {
        if (streamData[i].status == "live") {
            continue; // Reject currently live since we can't tell whether we've already announced
        };
        let streamProcessed = false;
        for (let streamId in fileCache['ytStreams']) {
            let stream = fileCache['ytStreams'][streamId]; // Passed by reference
            if (streamId == streamData[i].id) {
                streamProcessed = true;
                if (stream.available_at != streamData[i].available_at) {
                    clearTimeoutsManually(streamData[i].id, "streamId");
                    let timeUntilStream = new Date(streamData[i].available_at) - new Date();
                    if (timeUntilStream > 360000000) { // Stream has been rescheduled for over 100 hours in the future
                        console.log("Stream with ID: " + streamData[i].id + " was rescheduled for over 100 hours in the future, skipping announcement");
                        delete fileCache['ytStreams'][streamId];
                        client.channels.cache.get(process.env.BOT_CH_ID).send("Stream with ID: " + streamData[i].id + " was rescheduled for over 100 hours in the future, skipping announcement"); // Why doesn't this work??
                    }
                    else {
                        let announceTimeout = setTimeout(announceStream, timeUntilStream, streamData[i].id, channelId);
                        let debugMsg = "Rectified timer for announcement of " + streamData[i].id + ", " + timeUntilStream + " milliseconds remaining";
                        debugMsg += "\n" + "process" + "\n" + streamData[i].available_at + " (" + typeof(streamData[i].available_at) + ")"
                        debugMsg += "\n" + stream.available_at + " (" + typeof(stream.available_at) + ")";
                        console.log(debugMsg);
                        timeoutsActive.push(announceTimeout);
                        announcementTimeouts.push([announceTimeout, streamData[i].id]);
                        fileCache['ytStreams'][streamId] = streamData[i];
                    };
                };
                break;
            };
        };
        if (!streamProcessed) {
            for (let k = 0; k < announcementTimeouts.length; k++) {
                if (announcementTimeouts[k][1] == streamData[i].id) { // Stream has announcement pending but is not present in cache, panic
                    client.channels.cache.get(process.env.BOT_CH_ID).send(streamData[i].id + " was found in announcementTimeouts but not in streamData, panic!");
                    process.exit();
                };
            };
            let timeUntilStream = new Date(streamData[i].available_at) - new Date();
            let announceTimeout = setTimeout(announceStream, timeUntilStream, streamData[i].id, channelId);
            let debugMsg = "Set timer for announcement of " + streamData[i].id + ", " + timeUntilStream + " milliseconds remaining";
            console.log(debugMsg);
            timeoutsActive.push(announceTimeout);
            announcementTimeouts.push([announceTimeout, streamData[i].id]);
            fileCache['ytStreams'][streamData[i].id] = streamData[i];
        };
    };
    writeStreams();
    //let functionEnd = new Date();
    //let functionLength = functionEnd - functionStart
    //console.log("Request took " + functionLength + " ms")
};

async function processTwitchChannel(userId) {
    let streamData = {};
    try {
        streamData = await twitch.getLiveStreams(userId,twitchAPIKey);
    }
    catch(err) {
        console.error("Twitch API call gave bad data:");
        console.error(err);
        return;
    }
    let streamerInfo = getInfoFromTwitchChannelId(userId);
    if (typeof streamData == 'undefined') {
        console.log(userId);
        process.exit();
    }
    if (streamData.length == 0) { // User is not live
        for (let i = fileCache['twitchStreams'].length - 1; i >= 0; i--) { // Remove any of user's past streams from cache
            if (fileCache['twitchStreams'][i].user_id == userId) {
                fileCache['twitchStreams'].splice(i,1);
            };
        };
        fs.writeFileSync('twitchStreams.json', JSON.stringify(fileCache['twitchStreams']));
        return;
    }
    else {
        for (let i = 0; i < fileCache['twitchStreams'].length; i++) {
            if (fileCache['twitchStreams'][i].id == streamData[0].id) { // Stream has already been announced
                return;
            };
        };
        let timeSinceStart = (new Date() - new Date(streamData[0].started_at));
        if (timeSinceStart > 300000) { // Stream started over five minutes ago
            console.log("Skipping announcement for " + streamerInfo.shortName + ", stream started " + timeSinceStart + " milliseconds ago");
        }
        else {
            let guildChannelId = getAppropriateGuildChannel(streamerInfo.org);
            await fireTwitchAnnouncement(streamerInfo.shortName, guildChannelId, streamData[0].user_login, streamData[0].game_name);
        };
        fileCache['twitchStreams'].push(streamData[0]);
        fs.writeFileSync('twitchStreams.json', JSON.stringify(fileCache['twitchStreams']));
        return;
    };
};

async function announceStream(streamId, channelId) {
    let streamData = await youtubeScraper.getVideoById(streamId);
    incrementQuota();
    let streamerInfo = getInfoFromYtChannelId(channelId);
    let cacheData;
    let foundInCache = false;
    if (streamId in fileCache['ytStreams']) {
        cacheData = fileCache['ytStreams'][streamId];
        foundInCache = true;
    };
    if (streamData.status == "missing") {
        console.log(streamerInfo.shortName + " cancelled stream with ID: " + streamId + ", skipping announcement");
    }
    else {
        let timeUntilStream = new Date(streamData.available_at) - new Date();
        if (timeUntilStream < -300000 && streamData.status == "live") {// Stream has already started over five minutes ago
            console.log("Stream with ID: " + streamData.id + " started " + (timeUntilStream * -1) + " milliseconds ago, skipping announcement");
            console.log("Start time: " + streamData.available_at);
        }
        else if (timeUntilStream > 360000000) { // Stream has been rescheduled for over 100 hours in the future
            console.log("Stream with ID: " + streamId + " was rescheduled for over 100 hours in the future, skipping announcement");
            client.channels.cache.get(process.env.BOT_CH_ID).send("Stream with ID: " + streamId + " was rescheduled for over 100 hours in the future, skipping announcement");
        }
        else if (timeUntilStream > 60000 && streamData.status != "live") {// Stream has been rescheduled for at least a minute from now
            clearTimeoutsManually(streamData.id, "streamId");
            let announceTimeout = setTimeout(announceStream, timeUntilStream, streamData.id, channelId);
            let debugMsg = "Rectified timer for announcement of " + streamData.id + ", " + timeUntilStream + " milliseconds remaining";
            debugMsg += "\n" + "announce" + "\n" + streamData.available_at + " (" + typeof(streamData.available_at) + ")";
            if (foundInCache) {
                debugMsg += "\n" + cacheData.available_at + " (" + typeof(cacheData.available_at) + ")";
                fileCache['ytStreams'][streamId] = streamData;
            };
            console.log(debugMsg);
            timeoutsActive.push(announceTimeout);
            announcementTimeouts.push([announceTimeout, streamData.id]);
            return;
        }
        else if (streamData.status == "live") {
            let guildChannelId = getAppropriateGuildChannel(streamerInfo.org);
            await fireYtAnnouncement(streamerInfo.shortName, streamId, guildChannelId);
        }
        else if (streamData.status == "past") {
            console.log("Stream with ID: " + streamData.id + " already concluded, pruning");
        }
        else if (timeUntilStream < -3600000) { // Streamer is over an hour late
            console.log("Stream with ID: " + streamData.id + " is too late, pruning");
        }
        else if (timeUntilStream < -300000) { // Streamer is late, recheck for live in 2 minutes
            clearTimeoutsManually(streamData.id, "streamId");
            let announceTimeout = setTimeout(announceStream, 120000, streamData.id, channelId);
            let debugMsg = "Delaying announcement of " + streamData.id + " for 2 minutes (LATE)";
            console.log(debugMsg);
            timeoutsActive.push(announceTimeout);
            announcementTimeouts.push([announceTimeout, streamData.id]);
            if (foundInCache) {
                fileCache['ytStreams'][streamId] = streamData;
            };
            return;
        }
        else { // Recheck for live in 20 seconds
            clearTimeoutsManually(streamData.id, "streamId");
            let announceTimeout = setTimeout(announceStream, 20000, streamData.id, channelId);
            let debugMsg = "Delaying announcement of " + streamData.id + " for 20 seconds";
            console.log(debugMsg);
            timeoutsActive.push(announceTimeout);
            announcementTimeouts.push([announceTimeout, streamData.id]);
            if (foundInCache) {
                fileCache['ytStreams'][streamId] = streamData;
            };
            return;
        };
    };
    clearTimeoutsManually(streamData.id, "streamId");
    if (foundInCache) {
        delete fileCache['ytStreams'][streamId];
    };
};

async function fireYtAnnouncement(shortName = "YouTube Vtuber", videoId = "dQw4w9WgXcQ", guildChannelId = process.env.H_JP_ID) {// Verification should be done BEFORE this is called
    var verb = ' is ';
    if (shortName == "FUWAMOCO" || shortName == "Mint & Matara") {
        verb = ' are ';
    };
    var preAnnounce = (shortName + verb + "live!");
    var announce = "https://youtu.be/" + videoId;
    await client.channels.cache.get(guildChannelId).send(preAnnounce);
    await client.channels.cache.get(guildChannelId).send(announce);
    return;
};

async function fireTwitchAnnouncement(shortName = "Twitch Vtuber", guildChannelId = process.env.VSHOJO_ID, username = "ironmouse", game = "Just Chatting") {
    var preAnnounce = (shortName + " is live!");
    var announce = "https://www.twitch.tv/" + username;
    await client.channels.cache.get(guildChannelId).send(preAnnounce);
    await client.channels.cache.get(guildChannelId).send(announce);
    return;
};

// Discord stuff

client.on('ready', () => {
    let startupTime = new Date();
    let dateString = "";
    dateString += startupTime.getFullYear() + ":" + (startupTime.getMonth() + 1) + ":"
    + startupTime.getDate() + ":" + startupTime.getHours() + ":" + startupTime.getMinutes()
    + ":" + startupTime.getSeconds();
    console.log(`Logged in as ${client.user.tag} at ` + dateString);
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
            writeStreams();
            pool.end();
            await msg.reply('Confirmed logout.');
            client.destroy();
            console.log("Server shutting down");
            break;
        case 'log':
            console.log(msg);
            await msg.reply('Confirmed log.');
            break;
        case 'refresh':
            loadFileCache();
            await msg.reply('Confirmed refresh of file cache.');
            break;
        case 'quota':
            var quota = await rawQuery('SELECT * FROM quota WHERE platform = "live";');
            msg.reply('Quota usage is ' + quota[0].quotaValue + '.');
        case 'query test':
            let queryString = "SELECT * FROM " + process.env.DB_STREAMER_TABLE + " WHERE AnnounceName = 'Iroha';";
            let queryRes = await rawQuery(queryString);
            console.log("returned: " + JSON.stringify(queryRes));
        default:
            break;
    };
});

client.login(process.env.CLIENT_TOKEN);// No Discord stuff past this point

// Final initializations

loadFileCache();
setTimeout(function() {
    startupPurge();
    console.log("Synchronizing JSON");
    writeStreams();
    console.log("JSON synchronized");
    currentYtLoopTimeout = setTimeout(livestreamLoop, 15000, 0);
    timeoutsActive.push(currentYtLoopTimeout);
    twitchStartup();
    let currentTime = new Date();
    let nextMidnight = new Date(currentTime.getFullYear(),currentTime.getMonth(),currentTime.getDate()+1);
    let timeToMidnight = (nextMidnight - currentTime);
    currentMidnightTimeout = setTimeout(quotaDebug, timeToMidnight);
    timeoutsActive.push(currentMidnightTimeout);
}, 5000);
