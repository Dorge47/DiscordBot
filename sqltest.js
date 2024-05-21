#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const mariadb = require('mariadb');
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    connectionLimit: 5,
    database: process.env.DB_NAME
});
async function rawQuery(queryString) {
    let conn;
    let rows;
    try {
        conn = await pool.getConnection();
        rows = await conn.query(queryString);
        console.log(rows);
    } catch (err) {
        throw err;
    } finally {
        if (conn) await conn.end();
        return rows;
    }
};
async function testQuery() {
    let queryRes = await rawQuery("SELECT * FROM " + process.env.DB_STREAMER_TABLE + ";");
    fs.writeFileSync('sqlTest.txt', JSON.stringify(queryRes));
};
testQuery();