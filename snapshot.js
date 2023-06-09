const axios = require("axios");
const conf = require('ocore/conf.js');
const db = require('ocore/db.js');
const dag = require('aabot/dag.js');

const chain = 'kava';
let addressTypes = {};



function wait(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomTimeout(min, max) {
	return Math.round(min * 60 * 1000 + (max - min) * 60 * 1000 * Math.random());
}

async function getUrlWithRetries(url) {
	let r = 0;
	while (true) {
		try {
			return await axios.get(url);
		}
		catch (e) {
			console.log(`attempt ${r} getting ${url} failed`, e);
			if (r > 5)
				throw e;
			await wait(30_000);
			r++;
		}
	}
}

async function getBridges() {
	const { data } = await getUrlWithRetries(`${conf.cs_url}/bridges`);
	return data.data;
}

async function getEligibleAssets() {
	let assets = {};
	const bridges = await getBridges();
	for (const { home_network, foreign_network, home_asset, foreign_asset, home_asset_decimals, foreign_asset_decimals, home_symbol, foreign_symbol } of bridges) {
		if (home_network === 'Kava' && foreign_network === 'Obyte')
			assets[foreign_asset] = { home_asset, home_asset_decimals, foreign_asset_decimals, home_symbol, foreign_symbol };
	}
	return assets;
}


async function fetchERC20ExchangeRate(token_address) {
	const url = token_address === '0x0000000000000000000000000000000000000000'
		? `https://api.coingecko.com/api/v3/coins/kava`
		: `https://api.coingecko.com/api/v3/coins/${chain}/contract/${token_address.toLowerCase()}`;
	const { data } = await getUrlWithRetries(url);
	const prices = data.market_data.current_price;
	if (!prices.usd)
		console.log(`no price for token ${token_address}`);
	return prices.usd || 0;
}

async function getHolders(asset, offset = 0) {
	const { data } = await getUrlWithRetries(`${conf.explorer_url}/asset/${encodeURIComponent(asset)}/next_page_holders?offset=${offset}`);
	return data.end ? data.holders : data.holders.concat(await getHolders(asset, offset + 100));
}

async function getAddressType(address, conn = db) {
	let type = addressTypes[address];
	if (type)
		return type;
	const [row] = await conn.query("SELECT type FROM address_types WHERE address=?", [address]);
	if (row) {
		addressTypes[address] = row.type;
		return row.type;
	}
	const definition = await dag.readAADefinition(address);
	type = definition && definition[0] === 'autonomous agent' ? 'aa' : 'key';
	await conn.query("INSERT OR IGNORE INTO address_types (address, type) VALUES (?, ?)", [address, type]);
	addressTypes[address] = type;
	return type;
}

async function recordSnapshot() {
	console.log(`starting recordSnapshot`);
	let total_effective_usd_balance = 0;
	let exchange_rates_rows = [];
	let balances_rows = [];
	try {
		const assets = await getEligibleAssets();
		var conn = await db.takeConnectionFromPool();
		await conn.query("BEGIN");
		const res = await conn.query("INSERT INTO snapshots (snapshot_id) VALUES (NULL)");
		const snapshot_id = res.insertId;
		if (!snapshot_id)
			throw Error(`no snapshot id`);
		for (const asset in assets) {
			const { home_asset, home_asset_decimals, foreign_asset_decimals, home_symbol, foreign_symbol } = assets[asset];
			const multiplier = conf.multipliers[home_asset] || 1;
			const price = await fetchERC20ExchangeRate(home_asset);
			exchange_rates_rows.push(`(${snapshot_id}, ${db.escape(home_asset)}, ${db.escape(home_symbol)}, ${+price})`);
			const holders = await getHolders(asset);
			for (let { address, balance } of holders) {
				const type = await getAddressType(address, conn);
				if (type === 'aa') {
					console.log(`skipping address ${address} as it is an AA`);
					continue;
				}
				balance /= 10 ** foreign_asset_decimals;
				const effective_balance = balance * multiplier;
				const effective_usd_balance = effective_balance * price;
				total_effective_usd_balance += effective_usd_balance;
				balances_rows.push(`(${snapshot_id}, ${db.escape(address)}, ${db.escape(home_asset)}, ${db.escape(home_symbol)}, ${balance}, ${effective_balance}, ${effective_usd_balance})`);
			}
		}
		console.error(exchange_rates_rows)
		console.error(balances_rows)
		await conn.query(`INSERT INTO exchange_rates (snapshot_id, home_asset, home_symbol, exchange_rate) VALUES ` + exchange_rates_rows.join(', '));
		await conn.query(`INSERT INTO balances (snapshot_id, address, home_asset, home_symbol, balance, effective_balance, effective_usd_balance) VALUES ` + balances_rows.join(', '));
		await conn.query("UPDATE snapshots SET total_effecive_usd_balance=? WHERE snapshot_id=?", [total_effective_usd_balance, snapshot_id]);
		await conn.query("COMMIT");
		setTimeout(recordSnapshot, getRandomTimeout(0, 60));
		console.log(`done recordSnapshot`);
	}
	catch (e) {
		console.log(`recordSnapshot failed`, e);
		if (conn)
			await conn.query("ROLLBACK");
		setTimeout(recordSnapshot, getRandomTimeout(5, 10));
	}
	finally {
		if (conn)
			conn.release();
	}
}

exports.recordSnapshot = recordSnapshot;
