/* eslint-disable @typescript-eslint/no-use-before-define */
import { inflate } from 'pako';
import SqlString from 'sqlstring';
import { gzipSync } from 'zlib';
import { getConnection as getConnectionBgs } from './services/rds-bgs';

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	const input: Input = JSON.parse(event.body);

	const query = buildQuery(input);
	console.log('running query', query);

	const mysql = await getConnectionBgs();
	const results: any[] = ((await mysql.query(query)) as any[])
		.filter(result => result.jsonStats && result.jsonStats.length <= 50000)
		.map(result => {
			const stats = parseStats(result.jsonStats);
			return {
				reviewId: result.reviewId,
				stats: stats,
			};
		})
		.filter(result => result.stats);
	console.log('results', results);
	await mysql.end();
	const zipped = await zip(JSON.stringify(results));

	const response = {
		statusCode: 200,
		isBase64Encoded: true,
		body: zipped,
		headers: {
			'Content-Type': 'text/html',
			'Content-Encoding': 'gzip',
		},
	};
	console.log('sending back success reponse');
	return response;
};

const buildQuery = (input: Input): string => {
	const escape = SqlString.escape;
	if (input.reviewId) {
		return `
			SELECT * FROM bgs_single_run_stats
			WHERE reviewId = ${escape(input.reviewId)}
		`;
	} else {
		const heroCardCriteria = input.heroCardId ? `AND heroCardId = ${escape(input.heroCardId)} ` : '';
		const usernameCriteria = input.userName ? `OR userName = ${escape(input.userName)}` : '';
		return `
			SELECT * FROM bgs_single_run_stats
			WHERE (userId = ${escape(input.userId)} ${usernameCriteria})
			${heroCardCriteria}
			ORDER BY id DESC
		`;
	}
};

const zip = async (input: string) => {
	return gzipSync(input).toString('base64');
};

const parseStats = (inputStats: string): string => {
	try {
		const parsed = JSON.parse(inputStats);
		// console.log('parsed', parsed);
		return parsed;
	} catch (e) {
		try {
			// console.log('reading base64', inputStats);
			const fromBase64 = Buffer.from(inputStats, 'base64').toString();
			// console.log('fromBase64', fromBase64);
			const inflated = inflate(fromBase64, { to: 'string' });
			// console.log('inflated', inflated);
			return JSON.parse(inflated);
		} catch (e) {
			console.warn('Could not build full stats, ignoring review', inputStats);
			return null;
		}
	}
};
