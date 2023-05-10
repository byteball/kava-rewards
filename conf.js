"use strict";
const path = require('path');
require('dotenv').config({ path: path.dirname(process.mainModule.paths[0]) + '/.env' });

exports.bServeAsHub = false;
exports.bLight = true;
exports.bSingleAddress = true;

exports.bNoPassphrase = false;


exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.token_registry_address = "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ";

exports.cs_url = process.env.testnet ? 'https://testnet-bridge.counterstake.org/api' : 'https://counterstake.org/api';
exports.explorer_url = process.env.testnet ? 'https://testnetexplorer.obyte.org/api' : 'https://explorer.obyte.org/api';

// home asset => multiplier, for assets that generate double or triple TVL
exports.multipliers = {

};

exports.webPort = 5282;

console.log('finished server conf');
