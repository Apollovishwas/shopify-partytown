const dotenv = require('dotenv').config();
require('isomorphic-fetch');
const compression = require('compression');
const express = require('express');
const app = express();
const crypto = require('crypto');
const cookie = require('cookie');
const nonce = require('nonce')();
const querystring = require('querystring');
const request = require('request-promise');
const cors = require('cors');
const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET;
const scopes = 'read_products';
const forwardingAddress = process.env.HOST;

app.use(compression());

app.use((req, res, next) => {
  console.log(req.path);
  next();
})
app.use(cors({
  origin: 'https://partytownlib.myshopify.com' // Replace with your desired origin(s)
}));
app.use('/proxy', express.static('./proxy'));

app.get('/', (req, res) => {
  res.send('Hello PartyTown 2.0');
});

app.use('/reverse-proxy', async (req, res) => {
  try {
    const url = req.query.url;
    const response = await fetch(url, {
      method: req.method,
      // headers: req.headers,
      body: req.body
    });
    const responseContent = await response.text();
    // set fetch response headers to res headers
    [...response.headers].forEach(([key, value]) => { 
      if (key.toLowerCase() == 'access-control-allow-methods') { 
        res.setHeader(key, value);
      }
    });
    // remove powered-by-express header
    res.removeHeader('x-powered-by');
    // set cors headers
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // allow all headers
    res.setHeader('Access-Control-Allow-Headers', '*');
    // add a cache policy that caches for 1 day
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    res.send(responseContent);
  } catch (err) {
    res.status(500).send('Could not get resource');
  }
});

// Shopify install route
app.get('/shopify', (req, res) => {
  const shop = req.query.shop;
  if (shop) {
    const state = nonce();
    const redirectUri = forwardingAddress + '/shopify/callback';
    const installUrl = 'https://' + shop +
      '/admin/oauth/authorize?client_id=' + apiKey +
      '&scope=' + scopes +
      '&state=' + state +
      '&redirect_uri=' + redirectUri;

    res.cookie('state', state);
    res.redirect(installUrl);
  } else {
    return res.status(400).send('Missing shop parameter. Please add ?shop=your-development-shop.myshopify.com to your request');
  }
});

// Shopify callback route
app.get('/shopify/callback', (req, res) => {
  const { shop, hmac, code, state } = req.query;
  const stateCookie = cookie.parse(req.headers.cookie).state;

  if (state !== stateCookie) {
    return res.status(403).send('Request origin cannot be verified');
  }

  if (shop && hmac && code) {
    // DONE: Validate request is from Shopify
    const map = Object.assign({}, req.query);
    delete map['signature'];
    delete map['hmac'];
    const message = querystring.stringify(map);
    const providedHmac = Buffer.from(hmac, 'utf-8');
    const generatedHash = Buffer.from(
      crypto
        .createHmac('sha256', apiSecret)
        .update(message)
        .digest('hex'),
        'utf-8'
      );
    let hashEquals = false;
    // timingSafeEqual will prevent any timing attacks. Arguments must be buffers
    try {
      hashEquals = crypto.timingSafeEqual(generatedHash, providedHmac)
    // timingSafeEqual will return an error if the input buffers are not the same length.
    } catch (e) {
      hashEquals = false;
    };

    if (!hashEquals) {
      return res.status(400).send('HMAC validation failed');
    }

    // DONE: Exchange temporary code for a permanent access token
    const accessTokenRequestUrl = 'https://' + shop + '/admin/oauth/access_token';
    const accessTokenPayload = {
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    };

    request.post(accessTokenRequestUrl, { json: accessTokenPayload })
    .then((accessTokenResponse) => {
      const accessToken = accessTokenResponse.access_token;
      // DONE: Use access token to make API call to 'shop' endpoint
      const shopRequestUrl = 'https://' + shop + '/admin/api/2020-01/shop.json';
      const shopRequestHeaders = {
        'X-Shopify-Access-Token': accessToken,
      };

      request.get(shopRequestUrl, { headers: shopRequestHeaders })
      .then((shopResponse) => {
        res.status(200).end(shopResponse);
      })
      .catch((error) => {
        res.status(error.statusCode).send(error.error.error_description);
      });
    })
    .catch((error) => {
      res.status(error.statusCode).send(error.error.error_description);
    });

  } else {
    res.status(400).send('Required parameters missing');
  }
});


app.listen(process.env.PORT || 3000, () => {
  console.log('Example app listening on port ' + process.env.PORT || 3000 + '!');
});
