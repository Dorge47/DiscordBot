#!/usr/bin/env node
const fs = require('fs');
const youtubeScraper = require('./../YouTubeAPI/screwyYouTubeAPI.js');// https://github.com/Dorge47/YouTubeAPI
var fileCache = {};
fileCache['ytStreamers'] = JSON.parse(fs.readFileSync('YouTubeStreamers.json'));
fileCache['ytStreams'] = [];
async function testFunc() {
    let vidArr = [];
    for (let i = 0; i < fileCache['ytStreamers'].length; i++) {
        vidArr.push(youtubeScraper.getFutureVids(fileCache['ytStreamers'][i].id));
    };
    let result = await Promise.all(vidArr);
    console.log(result);
};
testFunc();
//fs.writeFileSync('rateLimitTest.json', JSON.stringify(fileCache['ytStreams']));
/*prom3 = new Promise(function(resolve) {
    setTimeout(function() {
        resolve(1);
    }, 10000);
});*/