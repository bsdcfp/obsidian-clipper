import { debugLog } from '../utils/debug';
import { feishuAdapter } from './feishu';
import { scysAdapter } from './scys';
import { SiteAdapter, SiteAdapterResult } from './types';

const adapters: SiteAdapter[] = [
	scysAdapter,
	feishuAdapter,
];

export async function extractWithSiteAdapter(document: Document): Promise<SiteAdapterResult | null> {
	for (const adapter of adapters) {
		if (!adapter.matches(document)) {
			continue;
		}

		try {
			const result = await adapter.extract(document);
			if (result) {
				debugLog('SiteAdapter', `Extracted with ${adapter.id}`);
				return result;
			}
		} catch (error) {
			console.warn(`[Obsidian Clipper] ${adapter.id} adapter failed:`, error);
		}
	}

	return null;
}
