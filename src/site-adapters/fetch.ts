import browser from '../utils/browser-polyfill';
import { AdapterFetchResponse } from './types';

export async function adapterFetchText(url: string, options: RequestInit = {}): Promise<string> {
	const headers: Record<string, string> = {};
	if (options.headers instanceof Headers) {
		options.headers.forEach((value, key) => {
			headers[key] = value;
		});
	} else if (Array.isArray(options.headers)) {
		for (const [key, value] of options.headers) {
			headers[key] = value;
		}
	} else if (options.headers) {
		Object.assign(headers, options.headers);
	}

	const parsedUrl = new URL(url, location.href);
	if (parsedUrl.hostname === 'scys.com' && !headers['X-TOKEN']) {
		headers['X-TOKEN'] = localStorage.getItem('__user_token.v3') || '';
	}

	if (parsedUrl.origin === location.origin) {
		const response = await fetch(parsedUrl.href, {
			...options,
			headers,
			credentials: options.credentials || 'include',
		});
		if (!response.ok) {
			throw new Error(`Fetch failed for ${url}: ${response.status}`.trim());
		}
		return response.text();
	}

	const response = await browser.runtime.sendMessage({
		action: 'siteAdapterFetch',
		url,
		options: {
			method: options.method || 'GET',
			headers,
			body: options.body || null,
			credentials: options.credentials || 'include',
		},
	}) as AdapterFetchResponse;

	if (!response?.ok) {
		throw new Error(`Fetch failed for ${url}: ${response?.status || 0} ${response?.error || ''}`.trim());
	}

	return response.text;
}

export async function adapterFetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
	return JSON.parse(await adapterFetchText(url, options)) as T;
}
