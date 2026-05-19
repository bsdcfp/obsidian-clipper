export interface SiteAdapterResult {
	adapterId: string;
	author?: string;
	contentHtml: string;
	contentMarkdown: string;
	description?: string;
	fullHtml: string;
	language?: string;
	published?: string;
	raw?: unknown;
	site: string;
	title: string;
	wordCount: number;
	extractedContent?: { [key: string]: string };
}

export interface SiteAdapter {
	id: string;
	matches(document: Document): boolean;
	extract(document: Document): Promise<SiteAdapterResult | null>;
}

export interface AdapterFetchResponse {
	ok: boolean;
	status: number;
	text: string;
	finalUrl?: string;
	error?: string;
}
