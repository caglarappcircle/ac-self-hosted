#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const dockerCredFile = process.argv[2];
const scope = process.argv[3];

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/g, '');
}

function createJWTGoogleCloud(credFilePath, jwtScope, validForSec) {
  validForSec = validForSec || 3600;
  const cred = JSON.parse(fs.readFileSync(credFilePath, 'utf8'));
  const privateKey = cred.private_key;
  const saEmail = cred.client_email;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: saEmail,
    scope: jwtScope,
    aud: 'https://www.googleapis.com/oauth2/v4/token',
    exp: now + validForSec,
    iat: now,
  };

  const requestBody = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(requestBody);
  const signature = base64url(sign.sign(privateKey));

  return requestBody + '.' + signature;
}

function requestAccessToken(jwtToken) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwtToken,
    });

    const options = {
      hostname: 'www.googleapis.com',
      port: 443,
      path: '/oauth2/v4/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.access_token);
        } catch (e) {
          reject(new Error('Failed to parse response: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const jwtToken = createJWTGoogleCloud(dockerCredFile, scope);
  const accessToken = await requestAccessToken(jwtToken);
  process.stdout.write(accessToken);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
